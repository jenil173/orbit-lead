import { adminAuth, adminDb } from '@/lib/firebase-admin';

// Helper: Server-side Regex Fallback Extraction (The Golden Guard)
function serverExtract(text: string) {
  const data: any = {};
  const t = text.toLowerCase();
  
  // Name extraction
  const nameMatch = text.match(/(?:my name is|i'm|i am)\s+([A-Z][a-z]+)/i);
  if (nameMatch) data.name = nameMatch[1];
  
  // Company extraction
  const coMatch = text.match(/(?:from|at|with)\s+([A-Z][a-zA-Z0-9]+)/);
  if (coMatch) data.company = coMatch[1];

  // Team Size extraction
  const teamMatch = t.match(/(\d+)\s*(?:people|team|members)/);
  if (teamMatch) data.teamSize = parseInt(teamMatch[1], 10);

  // Budget extraction (Fixed for commas)
  const budgetMatch = t.match(/(?:budget|₹|\$)\s*(\d+(?:,\d+)*(?:\s*[kK])?)/);
  if (budgetMatch) {
     const val = budgetMatch[1].replace(/,/g, '');
     let num = parseInt(val, 10);
     if (val.toLowerCase().includes('k') && num < 1000) num *= 1000;
     data.budget = num;
  }
  return data;
}

// Helper for scoring leads
function calculateScore(budget: number, teamSize: number, timeline: string): number {
  let score = 0;
  if (budget > 100000) score += 30;
  if (teamSize > 10) score += 20;
  
  const tl = (timeline || '').toLowerCase();
  if (tl.includes('soon') || tl.includes('asap') || tl.includes('now')) {
    score += 20;
  }
  return Math.min(score, 100);
}

export async function POST(req: Request) {
  const start = Date.now();
  const trace = (step: string) => console.log(`[TRACE] ${step} at +${Date.now() - start}ms`);

  try {
    trace("Request Received");

    // 1. Validate environment variables
    if (!process.env.GROQ_API_KEY) {
      console.error("[API] CRITICAL: GROQ_API_KEY is missing");
      return Response.json({ 
        reply: "Server configuration error: AI API key is missing." 
      }, { status: 500 });
    }

    // 2. Validate Request Body
    let message: string, conversationId: string, userId: string;
    try {
      const body = await req.json();
      message = body.message;
      conversationId = body.conversationId;
      userId = body.userId;
      trace("Body Parsed");
    } catch (e) {
      console.error("[API] Error parsing request body");
      return Response.json({ reply: "Invalid request format." }, { status: 400 });
    }

    if (!message) {
      return Response.json({ reply: "Message is required." }, { status: 400 });
    }

    // 3. Optional: Authentication Check
    const authHeader = req.headers.get('Authorization');
    if (authHeader?.startsWith('Bearer ')) {
      trace("Auth Verification Started");
      const idToken = authHeader.split('Bearer ')[1];
      try {
        await adminAuth.verifyIdToken(idToken);
        trace("Auth Verified");
      } catch (authError) {
        console.error("[API] Auth verification failed");
        return Response.json({ reply: "Session expired, please login again." }, { status: 401 });
      }
    }

    // 4. Fetch Conversation History & Lead State
    let history: Message[] = [];
    let convData: any = null;
    let currentLeadData: any = null;
    try {
      if (conversationId) {
        trace("Admin Firestore History Fetch Started");
        const convSnap = await adminDb.collection('conversations').doc(conversationId).get();
        if (convSnap.exists) {
          convData = convSnap.data();
          const rawHistory = convData.messages || [];
          
          const leadId = convData.leadId;
          if (leadId) {
            const leadSnap = await adminDb.collection('leads').doc(leadId).get();
            if (leadSnap.exists) {
              currentLeadData = leadSnap.data();
            }
          }

          // === HISTORY PRUNING (IRONCLAD GUARD) ===
          history = rawHistory.filter((m: any) => {
            if (m.role === 'assistant' && currentLeadData) {
              const content = m.content.toLowerCase();
              if (currentLeadData.budget > 0 && (content.includes('budget') || content.includes('monthly') || content.includes('₹'))) return false;
              if (currentLeadData.teamSize > 0 && (content.includes('team') || content.includes('members'))) return false;
              if (currentLeadData.timeline && (content.includes('timeline') || content.includes('when') || content.includes('weeks'))) return false;
              if (currentLeadData.name && currentLeadData.name !== 'Visitor' && (content.includes('your name') || content.includes('who are you'))) return false;
            }
            return true;
          }).slice(-6); 
        }
        trace("Admin Firestore Fetch Completed");
      }
    } catch (historyError) {
      console.error("[API] Error fetching history/lead:", historyError);
    }

    // TERMINATION RULE
    if (currentLeadData?.stage === 'completed') {
      return Response.json({ 
        reply: `Thanks for your interest, ${currentLeadData.name}! Our team will be in touch soon.`,
        action: "completed"
      });
    }

    // 5. Initialize AI Context
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });
    
    // Use Admin SDK for Pricing too
    let activePricing = { Starter: 50000, Growth: 100000, Enterprise: 200000 };
    try {
      const pricingSnap = await adminDb.collection('settings').doc('pricing').get();
      if (pricingSnap.exists) {
        activePricing = pricingSnap.data() as any;
        trace("Admin Pricing Fetched");
      }
    } catch (pe) {
      console.error("[API] Error fetching admin pricing:", pe);
    }

    const sp = activePricing.Starter || 50000;
    const gp = activePricing.Growth || 100000;
    const ep = activePricing.Enterprise || 200000;

    // === MILESTONE INJECTION (IRONCLAD GUARD) ===
    let nextMilestone = "COLLECT_INFO";
    const missingFields = [];
    if (!currentLeadData?.budget || currentLeadData.budget === 0) missingFields.push('BUDGET');
    if (!currentLeadData?.timeline || currentLeadData.timeline === '') missingFields.push('TIMELINE');
    if (!currentLeadData?.teamSize || currentLeadData.teamSize === 0) missingFields.push('TEAM_SIZE');
    if (!currentLeadData?.name || currentLeadData.name === 'Visitor') missingFields.push('NAME');

    if (missingFields.length === 0) nextMilestone = "PROPOSE_PLAN_AND_BOOK (All info collected)";
    else if (currentLeadData?.budget && currentLeadData?.teamSize) nextMilestone = "PROPOSE_SPECIFIC_PLAN";
    else nextMilestone = `COLLECT_${missingFields[0]}`;

    const knownList = currentLeadData ? Object.entries(currentLeadData)
      .filter(([k, v]) => v && v !== 'null' && v !== 'Visitor' && v !== 'Unknown' && v !== 0)
      .map(([k]) => k.toUpperCase())
      .join(', ') : "None";

    const leadSummary = currentLeadData ? 
      `[LEAD MEMORY]
      - Name: ${currentLeadData.name || 'Visitor'}
      - Company: ${currentLeadData.company || 'Unknown'}
      - Team Size: ${currentLeadData.teamSize || 'null'}
      - Monthly Budget: ₹${currentLeadData.budget || 'null'}
      - Timeline: ${currentLeadData.timeline || 'null'}
      - Stage: ${currentLeadData.stage || 'collecting'}` : 
      "No prior lead data.";

    // AGGRESSIVE SYSTEM PROMPT
    const systemPrompt = `
You are the OrbitLead AI Sales PRO. You are deterministic and NEVER repeat questions.
### MISSION OBJECTIVE ###
Current Milestone: ${nextMilestone}
KNOWN FIELDS (FORBIDDEN TO ASK): ${knownList}

### CRITICAL RULES ###
1. FORBIDDEN QUESTIONS: DO NOT ask for ${knownList}. 
2. CONTEXT OVER HISTORY: AI context is the [LEAD MEMORY]. If a field is there, it is known.
3. CONCISE: Be warm but very brief.

Return ONLY JSON:
{
  "reply": "...",
  "extracted_data": { "name": "...", "company": "...", "teamSize": number, "budget": number, "timeline": "..." },
  "intent": "demo" | "pricing" | "product_inquiry",
  "action": "ask" | "suggest" | "booked"
}
`;

    trace("AI Call Started");
    let aiResponseContent = "{}";
    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system' as any, content: systemPrompt },
          ...history.map((m: any) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as any,
            content: m.content || ""
          })),
          { role: 'system' as any, content: `[LEAD MEMORY] ${leadSummary}` },
          { role: 'user' as any, content: message }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });
      aiResponseContent = completion.choices[0]?.message?.content || "{}";
    } catch (aiError) {
      console.error("[API] AI call failed:", aiError);
      return Response.json({ reply: "I'm processing your request. Should we schedule a demo?" });
    }

    // 6. Parse & Nuclear Processing
    let parsedAI;
    try {
      parsedAI = JSON.parse(aiResponseContent);
    } catch (e) {
      parsedAI = { extracted_data: {} };
    }

    const { reply, extracted_data, action, intent } = parsedAI;
    
    // NUCLEAR FIX 1: Server-side fallback extraction
    const fallbackData = serverExtract(message);
    const finalExtracted = { ...fallbackData, ...extracted_data };

    // 7. Admin Firestore Processing (By-pass rules)
    if (conversationId) {
      trace("Admin Lead Update Started");
      try {
        const nameVal = (currentLeadData?.name && currentLeadData.name !== 'Visitor') ? currentLeadData.name : (finalExtracted.name || 'Visitor');
        const companyVal = (currentLeadData?.company && currentLeadData.company !== 'Unknown') ? currentLeadData.company : (finalExtracted.company || 'Unknown');
        
        // NUCLEAR FIX 2: Fixed parseNum with comma/multiplier support
        const parseNum = (val: any) => {
          if (typeof val === 'number') return val;
          const clean = String(val || "").replace(/,/g, "");
          const matches = clean.match(/\d+/g);
          if (matches && matches.length > 0) {
            let num = Number(matches[0]);
            if (clean.toLowerCase().includes('k') && num < 1000) num *= 1000;
            return num;
          }
          return 0;
        };

        const budgetVal = (currentLeadData?.budget && currentLeadData.budget > 0) ? currentLeadData.budget : parseNum(finalExtracted.budget);
        const teamVal = (currentLeadData?.teamSize && currentLeadData.teamSize > 0) ? currentLeadData.teamSize : parseNum(finalExtracted.teamSize);
        const timelineVal = currentLeadData?.timeline || finalExtracted.timeline || '';
        
        // Final State Machine
        let nextStage: LeadStage = currentLeadData?.stage || 'collecting';
        const keyFieldsKnown = [budgetVal > 0, teamVal > 0, timelineVal !== ''].filter(Boolean).length;
        if (nextStage === 'collecting' && keyFieldsKnown >= 2) nextStage = 'qualified';
        if (budgetVal > 0 && teamVal > 0) nextStage = 'proposed';
        if (action === 'booked' || intent === 'demo') nextStage = 'booked';

        const leadData = {
          name: nameVal,
          company: companyVal,
          teamSize: teamVal,
          budget: budgetVal,
          timeline: timelineVal,
          intent: intent || currentLeadData?.intent || 'product_inquiry',
          score: calculateScore(budgetVal, teamVal, timelineVal),
          stage: nextStage,
          updatedAt: Date.now()
        };

        const existingLeadId = convData?.leadId;
        let finalLeadId = existingLeadId;
        
        if (existingLeadId) {
          await adminDb.collection('leads').doc(existingLeadId).update(leadData);
        } else {
          const leadRef = await adminDb.collection('leads').add({
            ...leadData,
            createdAt: Date.now(),
            conversationId
          });
          finalLeadId = leadRef.id;
          await adminDb.collection('conversations').doc(conversationId).update({ leadId: finalLeadId });
        }
        trace("Admin Lead Update Success");
      } catch (err) {
        console.error("[API] Admin SDK Error:", err);
      }
    }

    return Response.json({ 
      reply: reply || "Thanks for the details! Shall we book a demo?", 
      action: action 
    });

  } catch (fatal) {
    console.error("[API] Fatal:", fatal);
    return Response.json({ reply: "System busy. Please try again." }, { status: 500 });
  }
}

