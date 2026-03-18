import { NextResponse } from 'next/server';
import { Groq } from 'groq-sdk';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, updateDoc } from 'firebase/firestore';
import pricingConfig from '@/pricing_config.json';
import { LeadStage, Message } from '@/types';
import { adminAuth } from '@/lib/firebase-admin';

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
    let convSnap;
    let currentLeadData: any = null;
    try {
      if (conversationId) {
        trace("Firestore History Fetch Started");
        const convRef = doc(db, 'conversations', conversationId);
        convSnap = await getDoc(convRef);
        if (convSnap.exists()) {
          history = convSnap.data().messages || [];
          history = history.slice(-10);
          
          const leadId = convSnap.data().leadId;
          if (leadId) {
            const leadSnap = await getDoc(doc(db, 'leads', leadId));
            if (leadSnap.exists()) {
              currentLeadData = leadSnap.data();
            }
          }
        }
        trace("Firestore History Fetched");
      }
    } catch (historyError) {
      console.error("[API] Error fetching history/lead:", historyError);
    }

    // TERMINATION RULE: If state is completed, STOP.
    if (currentLeadData?.stage === 'completed') {
      return Response.json({ 
        reply: `Thanks for your interest, ${currentLeadData.name}! Our team will be in touch soon regarding your scheduled ${currentLeadData.demoTime ? `demo on ${currentLeadData.demoTime}` : 'demo'}.`,
        action: "completed"
      });
    }

    // 5. Initialize Groq & Call AI
    trace("Groq AI Call Started");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });
    let aiResponseContent = "";
    
    // Fetch dynamic pricing from Firestore, fallback to JSON
    let activePricing = pricingConfig;
    try {
      const pricingSnap = await getDoc(doc(db, 'settings', 'pricing'));
      if (pricingSnap.exists()) {
        activePricing = pricingSnap.data() as any;
        trace("Dynamic Pricing Fetched");
      }
    } catch (pe) {
      console.error("[API] Error fetching dynamic pricing:", pe);
    }

    const sp = activePricing.Starter || 50000;
    const gp = activePricing.Growth || 100000;
    const ep = activePricing.Enterprise || 200000;

    const leadSummary = currentLeadData ? 
      `[LEAD MEMORY - DO NOT ASK THESE AGAIN]
      - Name: ${currentLeadData.name || 'Visitor'}
      - Company: ${currentLeadData.company || 'Unknown'}
      - Team Size: ${currentLeadData.teamSize || 'null'}
      - Monthly Budget: ₹${currentLeadData.budget || 'null'}
      - Timeline: ${currentLeadData.timeline || 'null'}
      - Stage: ${currentLeadData.stage || 'collecting'}` : 
      "No prior lead data.";

    // AGGRESSIVE SYSTEM PROMPT
    const systemPrompt = `
You are the OrbitLead AI Sales PRO. You are deterministic, efficient, and never repeat yourself.
Your MISSION: Qualify leads and book demos.

### CRITICAL INSTRUCTION (MEMORY SENTINEL) ###
- ALWAYS check the [LEAD MEMORY] provided in the next system message.
- IF A FIELD HAS A VALUE (not 'Visitor', 'Unknown', or 'null'), it is FORBIDDEN to ask for it. 
- Even if your previous message asked for it, if the value is now in memory, move to the NEXT missing field.
- If you ask for a known field, you fail your mission and the user will leave.

### CONVERSATION FLOW ###
1. Greet Arjun/Lead (only if Name is known).
2. Answer user questions briefly.
3. Identify MISSING data (Budget -> Timeline -> Team Size).
4. If Budget and Team are known: Suggest Plan (Enterprise > 200k, Growth 80k-150k, Basic < 50k).
5. If intent is "demo": Ask missing info OR confirm booking if all data is present.

Return ONLY JSON:
{
  "reply": "your direct, non-repetitive response",
  "extracted_data": { "name": "...", "company": "...", "teamSize": number, "budget": number, "timeline": "...", "demoTime": "..." },
  "intent": "demo" | "pricing" | "product_inquiry",
  "action": "ask" | "suggest" | "booked"
}
`;

    trace("Calling Groq with Memory Sentinel");
    console.log("[DEBUG] Sending to AI:", leadSummary);

    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system' as any, content: systemPrompt },
          ...history.map((m: any) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as any,
            content: m.content || ""
          })).filter(m => m.content.trim() !== ""),
          { role: 'system' as any, content: `[LEAD MEMORY] ${leadSummary}` },
          { role: 'user' as any, content: message }
        ],
        model: 'llama-3.3-70b-versatile',
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      aiResponseContent = completion.choices[0]?.message?.content || "{}";
      trace("Groq AI Call Completed");
    } catch (aiError: any) {
      console.error("[API] Groq API failure:", aiError);
      const isAuthError = aiError?.status === 401 || String(aiError).includes('invalid_api_key');
      return Response.json({ 
        reply: isAuthError 
          ? "AI configuration error: Invalid API Key." 
          : "Based on your details, I'd recommend our Growth plan. Would you like to book a demo to see it in action?" 
      }, { status: 200 }); // Return success with fallback for better UX
    }

    // 6. Parse AI Response safely
    let parsedAI;
    try {
      parsedAI = JSON.parse(aiResponseContent);
      console.log("[DEBUG] AI Extraction:", JSON.stringify(parsedAI.extracted_data));
    } catch (parseError) {
      console.error("[API] Error parsing AI response:", aiResponseContent);
      return Response.json({ reply: "I caught that! Should we schedule a demo to dive deeper into TechNova's needs?" });
    }

    const { reply, extracted_data, action, intent } = parsedAI;

    // 7. Deterministic Lead Processing
    if (extracted_data && conversationId) {
      trace("Firestore Lead Update Started");
      try {
        // Sticky Logic: Memory overrides extraction unless extraction is more specific
        const nameVal = (currentLeadData?.name && currentLeadData.name !== 'Visitor') ? currentLeadData.name : (extracted_data.name || 'Visitor');
        const companyVal = (currentLeadData?.company && currentLeadData.company !== 'Unknown') ? currentLeadData.company : (extracted_data.company || 'Unknown');
        
        const parseNum = (val: any) => {
          if (typeof val === 'number') return val;
          return Number(String(val || 0).replace(/[^0-9.]+/g, "")) || 0;
        };

        const budgetVal = (currentLeadData?.budget && currentLeadData.budget > 0) ? currentLeadData.budget : parseNum(extracted_data.budget);
        const teamVal = (currentLeadData?.teamSize && currentLeadData.teamSize > 0) ? currentLeadData.teamSize : parseNum(extracted_data.teamSize);
        
        const timelineVal = currentLeadData?.timeline || extracted_data.timeline || '';
        const demoTimeVal = currentLeadData?.demoTime || extracted_data.demoTime || '';

        // Deterministic State Management
        let nextStage: LeadStage = currentLeadData?.stage || 'collecting';
        const keyFieldsKnown = [budgetVal > 0, teamVal > 0, timelineVal !== ''].filter(Boolean).length;
        
        if (nextStage === 'collecting' && keyFieldsKnown >= 2) nextStage = 'qualified';
        if (action === 'suggest' || (budgetVal > 0 && teamVal > 0)) nextStage = 'proposed';
        
        if (action === 'booked' || intent === 'demo' || demoTimeVal) {
          if (keyFieldsKnown >= 3 && nameVal !== 'Visitor') {
            nextStage = 'completed';
          } else {
            nextStage = 'booked';
          }
        }

        const leadData = {
          name: nameVal,
          company: companyVal,
          teamSize: teamVal,
          budget: budgetVal,
          timeline: timelineVal,
          demoTime: demoTimeVal,
          intent: intent || currentLeadData?.intent || 'product_inquiry',
          score: calculateScore(budgetVal, teamVal, timelineVal),
          stage: nextStage,
          updatedAt: Date.now()
        };

        const existingLeadId = convSnap?.data()?.leadId;
        if (existingLeadId) {
          await updateDoc(doc(db, 'leads', existingLeadId), leadData);
        } else {
          const leadRef = await addDoc(collection(db, 'leads'), {
            ...leadData,
            createdAt: Date.now(),
            conversationId
          });
          await updateDoc(doc(db, 'conversations', conversationId), { leadId: leadRef.id });
        }
        trace("Firestore Lead Update Completed");
      } catch (leadError) {
        console.error("[API] Error updating lead data:", leadError);
      }
    }

    // 8. Final Response
    trace("Success - Returning Response");
    return Response.json({ 
      reply: reply || "I'm here to help you get started with OrbitLead!", 
      action: action 
    });

  } catch (fatalError: any) {
    console.error("[API] FATAL ERROR:", fatalError);
    return Response.json({ reply: "A system error occurred. Please refresh the page." }, { status: 500 });
  }
}

