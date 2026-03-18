import { NextResponse } from 'next/server';
import { Groq } from 'groq-sdk';
import { db } from '@/lib/firebase';
import { doc, getDoc, collection, addDoc, updateDoc } from 'firebase/firestore';
import pricingConfig from '@/pricing_config.json';
import { LeadStage } from '@/types';
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
        reply: `Thanks for your interest, ${currentLeadData.name}! Our team will be in touch soon regarding your ${currentLeadData.stage} demo.`,
        action: "completed"
      });
    }

    // 5. Initialize Groq & Call AI
    trace("Groq AI Call Started");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });
    let aiResponseContent = "";

    try {
      const sp = pricingConfig.Starter || 50000;
      const gp = pricingConfig.Growth || 100000;
      const ep = pricingConfig.Enterprise || 200000;

      const leadSummary = currentLeadData ? 
        `KNOWN DATA: Name: ${currentLeadData.name || 'null'}, Company: ${currentLeadData.company || 'null'}, Team: ${currentLeadData.teamSize || 'null'}, Budget: ${currentLeadData.budget || 'null'}, Timeline: ${currentLeadData.timeline || 'null'}, Stage: ${currentLeadData.stage || 'collecting'}` : 
        "No prior lead data.";

      const systemPrompt = `
You are a deterministic AI Sales Agent. NOT a chatbot. Follow these STRICT rules:

STATE MACHINE: collecting → qualified → proposed → booked → completed

DATA EXTRACTION:
- Extract: name, company, teamSize (number), budget (number), timeline.
- ${leadSummary}
- NEVER overwrite or ask for a field already known.
- NEVER change the user's name once set.

QUESTION STRATEGY:
- Ask ONLY ONE specific missing field at a time.
- Priority: 1. budget, 2. timeline, 3. teamSize.
- NO generic questions like "tell me more".

QUALIFICATION:
- If 3+ fields exist (e.g., teamSize, budget, timeline) AND stage is "collecting" → transition to "qualified".

PLAN SUGGESTION:
- Suggest ONLY if stage is "qualified" or "proposed".
- Logic: Budget ≤ ${sp} → Starter (₹${sp}), Budget ≤ ${gp} → Growth (₹${gp}), else Enterprise (₹${ep}).
- If proposing, set "action": "suggest".

BOOKING LOGIC:
- If user mentions: book, schedule, demo, meeting, call:
  * IF data missing: Ask ONLY the missing field.
  * IF info sufficient: Confirm booking, use user's name, set "action": "booked", set stage to "booked".

RESPONSE STYLE:
- Short, professional, direct. Use user's name. No loops.

Return JSON:
{
  "reply": "string",
  "extracted_data": { "name": "...", "company": "...", "teamSize": number, "budget": number, "timeline": "..." },
  "action": "ask" | "suggest" | "booked"
}
`;

      const completion = await groq.chat.completions.create({
        messages: [
          { role: 'system', content: systemPrompt },
          ...history.map((m: any) => ({
            role: m.role === 'assistant' ? 'assistant' : 'user',
            content: m.content
          })),
          { role: 'user', content: message }
        ],
        model: 'llama-3.1-8b-instant',
        temperature: 0.1,
        response_format: { type: 'json_object' }
      });

      aiResponseContent = completion.choices[0]?.message?.content || "{}";
      trace("Groq AI Call Completed");
    } catch (aiError) {
      console.error("[API] Groq API failure:", aiError);
      return Response.json({ reply: "Service temporarily unavailable." }, { status: 503 });
    }

    // 6. Parse AI Response safely
    let parsedAI;
    try {
      parsedAI = JSON.parse(aiResponseContent);
    } catch (parseError) {
      console.error("[API] Error parsing AI response:", aiResponseContent);
      return Response.json({ reply: "I encountered an error. Could you repeat that?" });
    }

    const { reply, extracted_data, action } = parsedAI;

    // 7. Process Lead Data & State Transitions
    if (extracted_data && conversationId) {
      trace("Firestore Lead Update Started");
      try {
        // Deterministic Extraction (NEVER overwrite)
        const budgetNum = Number(String(currentLeadData?.budget || extracted_data.budget || 0).replace(/[^0-9.-]+/g,"")) || 0;
        const teamNum = parseInt(String(currentLeadData?.teamSize || extracted_data.teamSize || 0), 10) || 0;
        const timelineStr = String(currentLeadData?.timeline || extracted_data.timeline || '');
        const nameStr = String(currentLeadData?.name || extracted_data.name || 'Visitor');
        const companyStr = String(currentLeadData?.company || extracted_data.company || 'Unknown');

        // Logic-based State Transition
        let nextStage: LeadStage = currentLeadData?.stage || 'collecting';
        
        const knownFieldsCount = [nameStr !== 'Visitor', companyStr !== 'Unknown', teamNum > 0, budgetNum > 0, timelineStr !== ''].filter(Boolean).length;
        
        if (nextStage === 'collecting' && knownFieldsCount >= 3) nextStage = 'qualified';
        if (action === 'suggest') nextStage = 'proposed';
        if (action === 'booked') nextStage = 'booked';
        if (nextStage === 'booked') nextStage = 'completed'; // Move to completed immediately after booking message

        const leadData = {
          name: nameStr,
          company: companyStr,
          teamSize: teamNum,
          budget: budgetNum,
          timeline: timelineStr,
          score: calculateScore(budgetNum, teamNum, timelineStr),
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

    // 8. Return final response
    trace("Success - Returning Response");
    return Response.json({ reply: reply || "How can I help you?", action });

  } catch (fatalError: any) {
    console.error("[API] FATAL ERROR:", fatalError);
    return Response.json({ 
      reply: "A server error occurred. Please refresh and try again." 
    }, { status: 500 });
  }
}

