import { NextResponse } from 'next/server';
import { Groq } from 'groq-sdk';
import { adminAuth, adminDb } from '@/lib/firebase-admin';
import { LeadStage, Message, PricingRule } from '@/types/index';
import fallbackPricing from '@/pricing_config.json';

// Helper: Server-side Regex Fallback Extraction (The Safety Guard)
function serverExtract(text: string) {
  const data: any = {};
  const t = text.toLowerCase();
  
  const nameMatch = text.match(/(?:my name is|i'm|i am|this is)\s+([A-Z][a-z]+)/i);
  if (nameMatch) data.name = nameMatch[1];
  
  const coMatch = text.match(/(?:from|at|with)\s+([A-Z][a-zA-Z0-9]+)/);
  if (coMatch) data.company = coMatch[1];

  const teamMatch = t.match(/(\d+)\s*(?:people|team|members|employees)/);
  if (teamMatch) data.teamSize = parseInt(teamMatch[1], 10);

  const budgetMatch = t.match(/(?:budget|₹|\$)\s*(\d+(?:,\d+)*(?:\s*[kK])?)/);
  if (budgetMatch) {
     const val = budgetMatch[1].replace(/,/g, '');
     let num = parseInt(val, 10);
     if (val.toLowerCase().includes('k') && num < 1000) num *= 1000;
     data.budget = num;
  }
  return data;
}

function getMatchedPlan(budget: number, pricingRules: PricingRule[]): string {
  if (!budget || budget <= 0) return "";
  const match = pricingRules.find(p => budget >= p.min && budget <= p.max);
  return match ? match.name : "Enterprise";
}

// Safety Question Logic: When AI fails or loops, ask for what's missing
function getSafetyQuestion(state: any): string {
  if (!state.name || state.name === 'Visitor') return "Before we dive in, could you tell me your name?";
  if (!state.budget || state.budget === 0) return `Nice to meet you, ${state.name}! Could you share your monthly budget for lead generation?`;
  if (!state.teamSize || state.teamSize === 0) return "Got it. How large is your sales team at the moment?";
  return "Would you like to schedule a quick demo to see how we can help you scale?";
}

export async function POST(req: Request) {
  try {
    if (!process.env.GROQ_API_KEY) {
      return Response.json({ reply: "AI API key missing." }, { status: 500 });
    }

    const { message, conversationId, userId } = await req.json();
    if (!message) return Response.json({ reply: "Message is required." }, { status: 400 });

    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY.trim() });

    // 1. Dynamic Pricing
    let pricingRules: PricingRule[] = fallbackPricing as PricingRule[];
    try {
      const pricingSnap = await adminDb.collection('settings').doc('pricing').get();
      if (pricingSnap.exists) {
        const data = pricingSnap.data();
        if (Array.isArray(data?.rules)) pricingRules = data.rules;
      }
    } catch (e) { console.error("Pricing fetch error:", e); }

    // 2. Persistent State Fetch
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

    const leadState = {
      name: currentLeadData?.name || 'Visitor',
      company: currentLeadData?.company || 'Unknown',
      teamSize: currentLeadData?.teamSize || 0,
      budget: currentLeadData?.budget || 0,
      requirement: currentLeadData?.requirement || '',
      demoTime: currentLeadData?.demoTime || '',
      intent: currentLeadData?.intent || 'info',
      stage: (currentLeadData?.stage as LeadStage) || 'New'
    };

    // 3. AI Turn
    const matchedPlan = getMatchedPlan(leadState.budget, pricingRules);
    
    const systemPrompt = `
You are the OrbitLead Sales Assistant.
CORE MEMORY: ${JSON.stringify(leadState)}
MATCHED PLAN: ${matchedPlan || "Unknown (Need budget)"}

GOAL: Qualify the lead and book a demo.
RULES:
1. NEVER ask a question if the answer is in CORE MEMORY.
2. If budget is known, suggest the ${matchedPlan} plan immediately.
3. If demo intent or time is detected, and we have name + (budget or team), CONFIRM THE DEMO.
4. Keep responses HUMAN, SHORT, and SALES-DRIVEN.
5. Return ONLY JSON.

Output format:
{
  "reply": "...",
  "extracted_data": { "name": "...", "company": "...", "teamSize": number, "budget": number, "requirement": "...", "demoTime": "..." },
  "intent": "info" | "budget" | "demo" | "feature",
  "action": "suggest" | "ask" | "confirm"
}
`;

    let aiResult: any;
    try {
      const completion = await groq.chat.completions.create({
        messages: [{ role: 'system', content: systemPrompt }, { role: 'user', content: message }],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });
      aiResult = JSON.parse(completion.choices[0]?.message?.content || "{}");
    } catch (aiErr) {
      console.error("AI Error:", aiErr);
      return Response.json({ 
        reply: getSafetyQuestion(leadState),
        state: leadState,
        stage: leadState.stage
      });
    }

    const { reply, extracted_data, intent, action } = aiResult;
    const fallback = serverExtract(message);
    
    // 4. State Merging (TRUST NEW DATA)
    const updateData: any = {
      updatedAt: Date.now(),
      intent: intent || leadState.intent
    };

    // Helper to overwrite if new data is valid
    const merge = (field: string, newValue: any, oldValue: any) => {
      if (newValue && newValue !== 'Visitor' && newValue !== 'Unknown' && newValue !== 0 && newValue !== '') return newValue;
      return oldValue;
    };

    updateData.name = merge('name', extracted_data?.name || fallback.name, leadState.name);
    updateData.company = merge('company', extracted_data?.company || fallback.company, leadState.company);
    updateData.teamSize = merge('teamSize', extracted_data?.teamSize || fallback.teamSize, leadState.teamSize);
    updateData.budget = merge('budget', extracted_data?.budget || fallback.budget, leadState.budget);
    updateData.requirement = merge('requirement', extracted_data?.requirement, leadState.requirement);
    updateData.demoTime = merge('demoTime', extracted_data?.demoTime, leadState.demoTime);

    // 5. Stage Management
    let nextStage: LeadStage = leadState.stage;
    if (nextStage === 'New' && (updateData.requirement || updateData.budget > 0)) nextStage = 'Qualified';
    if (updateData.demoTime && (updateData.name !== 'Visitor' && (updateData.budget > 0 || updateData.teamSize > 0))) nextStage = 'Demo Booked';
    updateData.stage = nextStage;

    // 6. Persistence
    if (conversationId) {
      if (convData?.leadId) {
        await adminDb.collection('leads').doc(convData.leadId).update(updateData);
      } else {
        const leadRef = await adminDb.collection('leads').add({
          ...updateData,
          createdAt: Date.now(),
          conversationId
        });
        await adminDb.collection('conversations').doc(conversationId).update({ leadId: leadRef.id });
      }
    }

    return Response.json({ 
      reply: reply || getSafetyQuestion(updateData), 
      state: updateData, 
      stage: nextStage 
    });

  } catch (fatal) {
    console.error("Fatal Error:", fatal);
    return Response.json({ reply: "I'm here to help. Could you tell me a bit more about what you're looking for?" }, { status: 500 });
  }
}

