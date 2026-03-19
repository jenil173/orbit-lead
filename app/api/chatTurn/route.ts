import { NextResponse } from 'next/server';
import { Groq } from 'groq-sdk';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { LeadStage, Message, PricingRule } from '@/types/index';
import fallbackPricing from '@/pricing_config.json';

// Helper: Server-side Regex Fallback Extraction
function serverExtract(text: string) {
  const data: any = {};
  const t = text.toLowerCase();
  
  // Name extraction
  const nameMatch = text.match(/(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+)/i);
  if (nameMatch) data.name = nameMatch[1];
  
  // Company extraction
  const coMatch = text.match(/(?:from|at|with)\s+([A-Z][a-zA-Z0-9]+)/);
  if (coMatch) data.company = coMatch[1];

  // Team Size extraction
  const teamMatch = t.match(/(\d+)\s*(?:people|team|members|employees)/);
  if (teamMatch) data.teamSize = parseInt(teamMatch[1], 10);

  // Budget extraction
  const budgetMatch = t.match(/(?:budget|₹|\$)\s*(\d+(?:,\d+)*(?:\s*[kK])?)/);
  if (budgetMatch) {
     const val = budgetMatch[1].replace(/,/g, '');
     let num = parseInt(val, 10);
     if (val.toLowerCase().includes('k') && num < 1000) num *= 1000;
     data.budget = num;
  }
  return data;
}

// Helper to match budget to plan
function getMatchedPlan(budget: number, pricingRules: PricingRule[]): string {
  if (!budget || budget <= 0) return "";
  const match = pricingRules.find(p => budget >= p.min && budget <= p.max);
  return match ? match.name : "Enterprise";
}

function calculateScore(budget: number, teamSize: number, timeline: string): number {
  let score = 0;
  if (budget > 100000) score += 40;
  if (teamSize > 10) score += 30;
  if (timeline.toLowerCase().includes('asap') || timeline.toLowerCase().includes('now')) score += 30;
  return Math.min(score, 100);
}

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return Response.json({ reply: "AI API key missing." }, { status: 500 });
    }

    const { message, conversationId, userId } = await req.json();
    if (!message) return Response.json({ reply: "Message is required." }, { status: 400 });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });

    // 1. Fetch Pricing Config (Dynamic)
    let pricingRules: PricingRule[] = fallbackPricing as PricingRule[];
    try {
      const pricingSnap = await adminDb.collection('settings').doc('pricing').get();
      if (pricingSnap.exists) {
        const data = pricingSnap.data();
        if (Array.isArray(data?.rules)) {
          pricingRules = data.rules;
        } else if (data) {
          // Handle old format if necessary, but prefer new list format
          const rules: PricingRule[] = [];
          if (data.Starter) rules.push({ name: 'Starter', min: 0, max: data.Starter });
          if (data.Growth) rules.push({ name: 'Growth', min: data.Starter || 0, max: data.Growth });
          if (data.Enterprise) rules.push({ name: 'Enterprise', min: data.Growth || 0, max: 1000000000 });
          if (rules.length > 0) pricingRules = rules;
        }
      }
    } catch (e) { console.error("Pricing fetch error:", e); }

    // 2. Fetch Lead State
    let currentLeadData: any = null;
    let convData: any = null;
    if (conversationId) {
      const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
      if (convSnap.exists) {
        convData = convSnap.data();
        if (convData.leadId) {
          const leadSnap = await adminDb.collection('leads').doc(convData.leadId).get();
          if (leadSnap.exists) currentLeadData = leadSnap.data();
        }
      }
    }

    // 3. Extraction & Decision Logic
    const leadState = {
      name: currentLeadData?.name || 'Visitor',
      company: currentLeadData?.company || 'Unknown',
      teamSize: currentLeadData?.teamSize || 0,
      budget: currentLeadData?.budget || 0,
      timeline: currentLeadData?.timeline || '',
      demoTime: currentLeadData?.demoTime || '',
      intent: currentLeadData?.intent || 'product_inquiry'
    };

    const matchedPlan = getMatchedPlan(leadState.budget, pricingRules);

    const systemPrompt = `
You are the OrbitLead Sales Executive. Your goal is to qualify leads and book demos.
Current Lead State: ${JSON.stringify(leadState)}
Matched Plan: ${matchedPlan || "Unknown (Need budget)"}

CRITICAL RULES:
1. NEVER ask for information already present in "Current Lead State".
2. If "budget" is known, IMMEDIATELY suggest the "${matchedPlan}" plan if you haven't already.
3. If "demoTime" is provided AND (budget > 0 OR teamSize > 0), confirm the booking instantly.
4. Keep responses SHORT, human-like, and sales-focused.
5. If all info is collected, move to booking a demo.
6. Return ONLY a JSON object.

Output Format:
{
  "reply": "Sales-focused response here",
  "extracted_data": { "name": "...", "company": "...", "teamSize": number, "budget": number, "timeline": "...", "demoTime": "..." },
  "intent": "demo" | "pricing" | "product_inquiry",
  "action": "ask" | "suggest" | "booked" | "close"
}
`;

    const completion = await groq.chat.completions.create({
      messages: [
        { role: 'system', content: systemPrompt },
        { role: 'user', content: message }
      ],
      model: 'llama-3.3-70b-versatile',
      temperature: 0.1,
      response_format: { type: 'json_object' }
    });

    const aiResult = JSON.parse(completion.choices[0]?.message?.content || "{}");
    const { reply, extracted_data, intent, action } = aiResult;

    // Merge logic
    const fallback = serverExtract(message);
    const finalExtracted = { ...fallback, ...extracted_data };

    const updateData: any = {
      updatedAt: Date.now(),
      intent: intent || leadState.intent
    };

    if (finalExtracted.name && leadState.name === 'Visitor') updateData.name = finalExtracted.name;
    if (finalExtracted.company && leadState.company === 'Unknown') updateData.company = finalExtracted.company;
    if (finalExtracted.teamSize && !leadState.teamSize) updateData.teamSize = finalExtracted.teamSize;
    if (finalExtracted.budget && !leadState.budget) updateData.budget = finalExtracted.budget;
    if (finalExtracted.timeline && !leadState.timeline) updateData.timeline = finalExtracted.timeline;
    if (finalExtracted.demoTime && !leadState.demoTime) updateData.demoTime = finalExtracted.demoTime;

    // Scoring & Stage
    const b = updateData.budget || leadState.budget;
    const t = updateData.teamSize || leadState.teamSize;
    const tl = updateData.timeline || leadState.timeline;
    const dt = updateData.demoTime || leadState.demoTime;

    updateData.score = calculateScore(b, t, tl);
    
    let stage: LeadStage = currentLeadData?.stage || 'collecting';
    if (b > 0 && t > 0) stage = 'qualified';
    if (b > 0 && matchedPlan) stage = 'proposed';
    if (dt && (b > 0 || t > 0)) stage = 'booked';
    if (action === 'close') stage = 'completed';
    updateData.stage = stage;

    // Save to Firestore
    if (conversationId) {
      if (convData?.leadId) {
        await adminDb.collection('leads').doc(convData.leadId).update(updateData);
      } else {
        const leadRef = await adminDb.collection('leads').add({
          ...leadState,
          ...updateData,
          createdAt: Date.now(),
          conversationId
        });
        await adminDb.collection('conversations').doc(conversationId).update({ leadId: leadRef.id });
      }
    }

    return Response.json({ reply, action });

  } catch (error: any) {
    console.error("Chat API Error:", error);
    return Response.json({ reply: "I'm having trouble. Let's talk about your needs." }, { status: 500 });
  }
}

