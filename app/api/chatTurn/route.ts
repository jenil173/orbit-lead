import { NextResponse } from 'next/server';
import { Groq } from 'groq-sdk';
import { getAdminDb } from '@/lib/firebase-admin';
import * as admin from 'firebase-admin';
import { LeadStage, Message, PricingRule } from '@/types/index';
import fallbackPricing from '@/pricing_config.json';
// Helper: Strip quotes from env vars
function stripQuotes(str: string | undefined): string {
  if (!str) return '';
  let s = str.trim();
  if (s.startsWith('"') && s.endsWith('"')) s = s.substring(1, s.length - 1);
  if (s.startsWith("'") && s.endsWith("'")) s = s.substring(1, s.length - 1);
  return s.trim();
}

// Helper: Enhanced Regex Fallback Extraction
function serverExtract(text: string, currentState: any) {
  const data: any = {};
  const t = text.trim();
  const lowerT = t.toLowerCase();
  
  // 1. Name extraction
  const nameMatch = t.match(/(?:my name is|i'm|i am|this is|call me)\s+([A-Z]?[a-zA-Z]+)/i);
  if (nameMatch) {
    data.name = nameMatch[1];
  } else if (t.split(/\s+/).length === 1 && t.length > 2 && /^[A-Z]/.test(t)) {
    data.name = t;
  }

  // 2. Company extraction
  const coMatch = t.match(/(?:from|at|with)\s+([A-Z][a-zA-Z0-9]+)/);
  if (coMatch) data.company = coMatch[1];

  // 3. Team size
  const teamMatch = lowerT.match(/(\d+)\s*(?:people|team|members|employees)/);
  if (teamMatch) data.teamSize = parseInt(teamMatch[1], 10);

  // 4. Budget
  const budgetMatch = lowerT.match(/(?:budget|₹|\$)\s*(\d+(?:,\d+)*(?:\s*[kK])?)/);
  if (budgetMatch) {
     const val = budgetMatch[1].replace(/,/g, '');
     let num = parseInt(val, 10);
     if (val.toLowerCase().includes('k') && num < 1000) num *= 1000;
     data.budget = num;
  }

  // 5. "Already told you" detection - if user is frustrated, try to find info in text again
  if (lowerT.includes("already") || lowerT.includes("told") || lowerT.includes("shared")) {
     // Re-scan for anything missing
     if (!currentState.name || currentState.name === 'Visitor') {
        const anyWord = t.match(/([A-Z][a-z]+)/);
        if (anyWord) data.name = anyWord[1];
     }
  }

  return data;
}

function getMatchedPlan(budget: number, pricingRules: PricingRule[]): string {
  if (!budget || budget <= 0) return "";
  const match = pricingRules.find(p => budget >= p.min && budget <= p.max);
  return match ? match.name : "Enterprise";
}

function getSafetyQuestion(state: any): string {
  if (!state.name || state.name === 'Visitor') return "Before we dive in, could you tell me your name?";
  if (!state.budget || state.budget === 0) return `Nice to meet you, ${state.name}! Could you share your monthly budget for lead generation?`;
  if (!state.teamSize || state.teamSize === 0) return "Got it. How large is your sales team at the moment?";
  return "Would you like to schedule a quick demo to see how we can help you scale?";
}

export async function POST(req: Request) {
  try {
    const apiKey = stripQuotes(process.env.GROQ_API_KEY);
    if (!apiKey) {
      console.error("[FATAL] API Key missing");
      return NextResponse.json({ reply: "AI API key missing." }, { status: 500 });
    }

    const { message, conversationId } = await req.json().catch(() => ({}));
    if (!message) return NextResponse.json({ reply: "Message is required." }, { status: 400 });

    console.log(`[TURN] Message: "${message}" | Conv: ${conversationId}`);

    const groq = new Groq({ apiKey });

    // Ensure DB is ready
    const adminDb = getAdminDb();

    // 1. Dynamic Pricing
    let pricingRules: PricingRule[] = fallbackPricing as PricingRule[];
    try {
      const pricingSnap = await adminDb.collection('settings').doc('pricing').get();
      if (pricingSnap.exists) {
        const pData = pricingSnap.data();
        if (Array.isArray(pData?.rules)) pricingRules = pData.rules;
      }
    } catch (e) { console.error("[ERROR] Pricing:", e); }

    // 2. Persistent State & History
    let currentLeadData: any = null;
    let convData: any = null;
    let history: any[] = [];

    if (conversationId) {
      const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
      if (convSnap.exists) {
        convData = convSnap.data();
        history = (convData.messages || [])
          .filter((m: any) => ['user', 'assistant'].includes(m.role))
          .slice(-10)
          .map((m: any) => ({ role: m.role, content: m.content }));
        
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

    console.log(`[STATE] ${JSON.stringify(leadState)}`);

    // 3. Ultra-Robust AI Prompting
    const matchedPlan = getMatchedPlan(leadState.budget, pricingRules);
    
    // Check if this is a new conversation to reset certain fields
    const isNewConversation = history.length === 0;
    if (isNewConversation) {
      leadState.demoTime = '';
      leadState.intent = 'info';
      leadState.stage = 'New';
    }

    // Plan Features for Explanation
    const planFeatures: any = {
      "Starter": ["Lead tracking", "Basic CRM", "1 Team member", "Email support"],
      "Growth": ["Lead tracking and pipeline management", "Automated follow-ups", "Team collaboration", "Performance analytics"],
      "Enterprise": ["Custom integration", "Advanced automation", "Unlimited team members", "Priority 24/7 support"]
    };

    const systemPrompt = `
You are the OrbitLead Sales Assistant. Your goal is to move leads through the sales pipeline:
- New Leads (Initial)
- Qualified (Requirement shared)
- Proposed (Budget shared)
- Demo Booked (Demo date/time confirmed)
- Closed (User confirms purchase)

STRICT STATUS (WHAT YOU ALREADY KNOW):
- Lead Name: ${leadState.name}
- Company: ${leadState.company}
- Team Size: ${leadState.teamSize}
- Budget: ₹${leadState.budget}
- Current Plan: ${matchedPlan || "None"}
- Current Stage: ${leadState.stage}

STRICT CONVERSATION RULES:
1. NEVER use "$" or "USD". Use only "₹" or "INR".
2. If the user mentions "$", assume it's "₹" or normalize it to INR.
3. NEVER ask for information already listed as known.
4. BE HUMAN, CONCISE, AND SALES-DRIVEN.

PLAN EXPLANATION (ONLY using ₹):
- Recommend: "Based on your requirements, our ${matchedPlan} plan is the best fit 👍"
- Features: List 3-4 features from: ${planFeatures[matchedPlan]?.join(", ") || "Standard lead tools"}
- Value: "This will help you stay organized and improve conversions."
- CTA: "Would you like to schedule a demo?"

Return ONLY JSON:
{
  "reply": "...",
  "extracted_data": { "name": "...", "budget": 12345, "demoTime": "Friday 3PM", "intent": "demo | purchase | quality" },
  "intent": "greeting | requirement | budget | demo | purchase",
  "action": "ask | suggest | confirm"
}
`;

    let aiResult: any;
    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          ...history,
          { role: 'user', content: message }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1, 
        response_format: { type: 'json_object' }
      });
      
      const content = completion.choices[0]?.message?.content;
      aiResult = JSON.parse(content || "{}");
      console.log(`[AI] ${content}`);
    } catch (aiErr) {
      console.error("[AI ERROR]", aiErr);
      aiResult = { reply: getSafetyQuestion(leadState), intent: 'info', action: 'ask' };
    }

    const { reply, extracted_data, intent } = aiResult;
    const fallback = serverExtract(message, leadState);
    
    // 4. Atomic State Merging
    const updateData: any = {
      updatedAt: Date.now(),
      intent: intent || leadState.intent
    };

    const merge = (field: string, newValue: any, oldValue: any) => {
      const isNewValid = newValue !== undefined && newValue !== null && newValue !== '' && newValue !== 0 && newValue !== 'Visitor' && newValue !== 'Unknown';
      if (isNewValid) {
        if (field === 'name' && typeof newValue === 'string') return newValue.trim().replace(/^['"]|['"]$/g, '');
        return newValue;
      }
      return oldValue;
    };

    updateData.name = merge('name', extracted_data?.name || fallback.name, leadState.name);
    updateData.company = merge('company', extracted_data?.company || fallback.company, leadState.company);
    updateData.teamSize = merge('teamSize', extracted_data?.teamSize || fallback.teamSize, leadState.teamSize);
    updateData.budget = merge('budget', extracted_data?.budget || fallback.budget, leadState.budget);
    updateData.requirement = merge('requirement', extracted_data?.requirement, leadState.requirement);
    updateData.demoTime = merge('demoTime', extracted_data?.demoTime, leadState.demoTime);

    // 5. Stage Transitions (FRESH RECOMPUTATION - NO CARRYOVER)
    let nextStage: LeadStage = 'New';
    
    const hasRequirement = updateData.requirement || intent === 'requirement' || leadState.requirement;
    const hasBudget = updateData.budget > 0 || intent === 'budget' || leadState.budget > 0;
    const hasDemo = updateData.demoTime || intent === 'demo' || leadState.demoTime;
    const isClosed = intent === 'purchase' || /proceed|buy|purchase|yes|confirm|deal/i.test(message);

    // PRIORITY LOGIC
    if (isClosed && (hasDemo || hasBudget)) {
      nextStage = 'Completed'; // Closed
    } else if (hasDemo && updateData.name !== 'Visitor') {
      nextStage = 'Booked'; // Demo Booked
    } else if (hasBudget) {
      nextStage = 'Proposed'; // Proposed
    } else if (hasRequirement) {
      nextStage = 'Qualified'; // Qualified
    } else {
      nextStage = 'New'; // New Leads
    }

    updateData.stage = nextStage;

    // 6. Persistence
    if (conversationId) {
      try {
        let finalLeadId = convData?.leadId;
        const leadCollection = adminDb.collection('leads');
        
        if (!finalLeadId) {
          const leadRef = await leadCollection.add({ ...updateData, createdAt: Date.now(), conversationId });
          finalLeadId = leadRef.id;
          await adminDb.collection('conversations').doc(conversationId).update({ leadId: finalLeadId });
        } else {
          await leadCollection.doc(finalLeadId).update(updateData);
        }

        const finalReply = reply || getSafetyQuestion(updateData);
        await adminDb.collection('conversations').doc(conversationId).update({
          messages: admin.firestore.FieldValue.arrayUnion({
            role: 'assistant',
            content: finalReply,
            timestamp: Date.now()
          }),
          updatedAt: Date.now()
        });
      } catch (saveErr) { console.error("[DB ERROR]", saveErr); }
    }

    return NextResponse.json({ reply: reply || getSafetyQuestion(updateData), state: updateData, stage: nextStage });

  } catch (fatal: any) {
    console.error("[FATAL]", fatal);
    const errDetail = fatal?.message || "Internal crash";
    return NextResponse.json({ 
      reply: `I'm having a technical glitch. (Detail: ${errDetail}) Try sharing that detail again.`, 
      error: errDetail 
    }, { status: 500 });
  }
}
