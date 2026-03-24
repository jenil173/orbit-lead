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

function getMatchedPlan(budget: number, pricingRules: any): string {
  if (!budget || budget <= 0) return "";
  
  // Handle Array structure (fallback/old)
  if (Array.isArray(pricingRules)) {
    const match = pricingRules.find((p: any) => budget >= p.min && budget <= p.max);
    return match ? match.name : "Enterprise";
  }
  
  // Handle New Flat Object with nested PlanConfig
  if (pricingRules.Starter?.price) {
    const p = pricingRules;
    if (budget <= p.Starter.price) return p.Starter.name;
    if (budget <= p.Growth.price) return p.Growth.name;
    return p.Enterprise.name;
  }

  // Handle Old Flat Object structure (numbers)
  const p = pricingRules;
  if (budget <= (p.Starter || 50000)) return "Starter";
  if (budget <= (p.Growth || 100000)) return "Growth";
  return "Enterprise";
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
    let pricingRules: any = fallbackPricing;
    let pricingAvailable = false;
    try {
      const pricingSnap = await adminDb.collection('settings').doc('pricing').get();
      if (pricingSnap.exists) {
        const pData = pricingSnap.data();
        const rawRules = pData?.rules || pData;
        
        // Normalize: Ensure we have the new object structure even if DB has old format
        const normalized: any = {};
        ['Starter', 'Growth', 'Enterprise'].forEach(key => {
          const fallback = (fallbackPricing as any)[key] || { name: key, price: 0, features: [] };
          const raw = rawRules[key];
          
          if (typeof raw === 'number') {
             normalized[key] = { name: key, price: raw, features: fallback.features };
          } else if (raw?.price) {
             normalized[key] = {
                ...raw,
                features: (raw.features && raw.features.length > 0) ? raw.features : fallback.features
             };
          } else {
             normalized[key] = fallback;
          }
        });
        pricingRules = normalized;
        pricingAvailable = true;
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

    // Format pricing for the prompt
    let pricingContext = "";
    if (pricingAvailable) {
       pricingContext = Object.values(pricingRules).map((p: any) => 
         `${p.name} - ₹${p.price}\n` + (p.features && p.features.length > 0 ? p.features.map((f: string) => `• ${f}`).join("\n") : "• Standard lead generation tools")
       ).join("\n\n");
    }

    const systemPrompt = `
You are the OrbitLead Sales Assistant. Your goal is to move leads through the sales pipeline.

CURRENT PRICING CONFIGURATION:
${pricingAvailable ? pricingContext : "NOT_AVAILABLE"}

${!pricingAvailable ? 'CRITICAL: Pricing information is currently unavailable. If the user asks about pricing, respond with: "We offer several plans depending on team size and requirements. I can explain them once pricing information is available, or help recommend the best option for your needs."' : ''}

STRICT STATUS (WHAT YOU ALREADY KNOW):
- Lead Name: ${leadState.name}
- Company: ${leadState.company}
- Team Size: ${leadState.teamSize}
- Budget: ₹${leadState.budget}
- Current Plan: ${matchedPlan || "None"}
- Current Stage: ${leadState.stage}

STRICT CONVERSATION RULES:
1. NEVER use "$" or "USD". Use only "₹" or "INR".
2. If the user asks about pricing, plans, or packages: IMMEDIATELY show the plans from the configuration. DO NOT ask for company name or team size first.
3. EXPLAIN plans in detail: When explaining features, describe the VALUE of each feature.
4. DEVELOPER INFO: If asked "Who built this?", "Who is the developer?", or "Who created this project?", respond: "This project was developed by Jenil Gajipara. Jenil is a developer focused on building modern web applications and AI-powered tools. You can explore more about his work here: GitHub: https://github.com/jenil173 | LinkedIn: https://www.linkedin.com/in/jenil-gajipara"
5. INSTAGRAM RULE: Share Jenil's Instagram (https://www.instagram.com/jenil_gajipara) ONLY if explicitly asked. Do NOT include it in the general developer response.
6. SECURITY: NEVER reveal email, phone numbers, or private data. Only share the public links provided.
7. ALWAYS list specific features for EACH plan. Even if they share some features, emphasize the unique upgrades in higher tiers.
8. NEVER generate fake prices. YOU MUST ONLY USE THE EXACT PRICES LISTED IN THE "CURRENT PRICING CONFIGURATION" ABOVE.
9. DO NOT use old prices like 5,000 or 15,000 unless they are explicitly in the configuration now.
10. If pricing info is NOT_AVAILABLE, use the specific fallback message mentioned above.
11. RECOMMEND a plan ONLY if team size or budget is known. Otherwise, just explain the plans.
12. If the user only asks about pricing, DO NOT immediately push for a demo. Instead ask: "Would you like help choosing the best plan for your team?"
13. BE HUMAN, CONCISE, AND SALES-DRIVEN.

Return ONLY JSON:
{
  "reply": "...",
  "extracted_data": { "name": "...", "budget": 12345, "demoTime": "Friday 3PM", "intent": "demo | purchase | quality" },
  "intent": "greeting | requirement | budget | demo | purchase | pricing",
  "action": "ask | show_plans | suggest | confirm"
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
