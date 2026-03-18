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
      `LEAD MEMORY: Name: ${currentLeadData.name || 'null'}, Company: ${currentLeadData.company || 'null'}, Team: ${currentLeadData.teamSize || 'null'}, Budget: ${currentLeadData.budget || 'null'}, Timeline: ${currentLeadData.timeline || 'null'}, DemoTime: ${currentLeadData.demoTime || 'null'}, Stage: ${currentLeadData.stage || 'collecting'}` : 
      "No prior lead data.";

    const systemPrompt = `
You are the OrbitLead AI Sales Assistant - a high-performance, goal-driven agent (not a chatbot).
Your MISSION: Progress leads through the funnel: collecting → qualified → proposed → booked → completed.

--- LOGIC RULES (STRICT) ---
1. MEMORY PRESERVATION: ${leadSummary}. 
   - NEVER ask for information that is already in LEAD MEMORY.
   - NEVER change the user's name or company once set.
2. QUESTION STRATEGY:
   - Ask exactly ONE missing field at a time.
   - Priority: Budget -> Timeline -> Team Size.
   - No generic questions. Be direct and professional.
3. QUALIFICATION & PRICING:
   - Qualify once 3+ fields exist (e.g., budget, timeline, teamSize).
   - Suggest Plan: budget ≤ ₹${sp} (Starter: ₹${sp}), budget ≤ ₹${gp} (Growth: ₹${gp}), Else (Enterprise: ₹${ep}).
   - Always mention the price from LEAD MEMORY config.
4. BOOKING TRIGGER:
   - If user mentions: book, demo, schedule, meeting, call:
     * Missing fields? Ask ONLY for the missing fields first.
     * All info present? Extract "demoTime" (e.g., "Friday at 2pm"), confirm, set "action": "booked".
5. CONVERSATION END: 
   - Use the user's name. Confirm the booking and time. Stop asking questions.

--- OUTPUT FORMAT (JSON ONLY) ---
{
  "reply": "your direct, personalized response",
  "extracted_data": { 
    "name": "string (don't overwrite)", 
    "company": "string (don't overwrite)", 
    "teamSize": number, 
    "budget": number, 
    "timeline": "string",
    "demoTime": "string (e.g. 'Friday 2pm')"
  },
  "action": "ask" | "suggest" | "booked"
}
`;

    try {
      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system' as any, content: systemPrompt },
          ...history.map((m: any) => ({
            role: (m.role === 'assistant' ? 'assistant' : 'user') as any,
            content: m.content || ""
          })).filter(m => m.content.trim() !== ""),
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
          ? "AI configuration error: Invalid API Key. Please check your environment variables." 
          : "The AI service is currently busy. Please try again in a few seconds." 
      }, { status: aiError?.status || 503 });
    }

    // 6. Parse AI Response safely
    let parsedAI;
    try {
      parsedAI = JSON.parse(aiResponseContent);
    } catch (parseError) {
      console.error("[API] Error parsing AI response:", aiResponseContent);
      return Response.json({ reply: "I'm sorry, I hit a snag. Could you please repeat that?" });
    }

    const { reply, extracted_data, action } = parsedAI;

    // 7. Deterministic Lead Processing
    if (extracted_data && conversationId) {
      trace("Firestore Lead Update Started");
      try {
        // PRESERVE STICKY DATA: Never overwrite a field once it has a non-null value.
        const nameVal = currentLeadData?.name || extracted_data.name || 'Visitor';
        const companyVal = currentLeadData?.company || extracted_data.company || 'Unknown';
        const budgetVal = Number(String(currentLeadData?.budget || extracted_data.budget || 0).replace(/[^0-9.-]+/g,"")) || 0;
        const teamVal = parseInt(String(currentLeadData?.teamSize || extracted_data.teamSize || 0), 10) || 0;
        const timelineVal = currentLeadData?.timeline || extracted_data.timeline || '';
        const demoTimeVal = currentLeadData?.demoTime || extracted_data.demoTime || '';

        // Deterministic State Management
        let nextStage: LeadStage = currentLeadData?.stage || 'collecting';
        
        // Qualification Check: 3+ fields known (budget, timeline, teamSize are key)
        const keyFieldsKnown = [budgetVal > 0, timelineVal !== '', teamVal > 0].filter(Boolean).length;
        if (nextStage === 'collecting' && keyFieldsKnown >= 2) nextStage = 'qualified';
        
        if (action === 'suggest') nextStage = 'proposed';
        
        if (action === 'booked' || (demoTimeVal && keyFieldsKnown >= 3)) {
          nextStage = 'completed'; // Booking finalized
        }

        const leadData = {
          name: nameVal,
          company: companyVal,
          teamSize: teamVal,
          budget: budgetVal,
          timeline: timelineVal,
          demoTime: demoTimeVal,
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

