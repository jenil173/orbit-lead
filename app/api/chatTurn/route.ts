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
    let history = [];
    let convSnap;
    let currentLeadData = null;
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

    // 5. Initialize Groq & Call AI
    trace("Groq AI Call Started");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });
    let aiResponseContent = "";

    try {
      const sp = pricingConfig.Starter;
      const gp = pricingConfig.Growth;
      const ep = pricingConfig.Enterprise;

      const leadSummary = currentLeadData ? 
        `Current known data: Name: ${currentLeadData.name || 'Unknown'}, Company: ${currentLeadData.company || 'Unknown'}, Team: ${currentLeadData.teamSize || 'Unknown'}, Budget: ${currentLeadData.budget || 'Unknown'}, Timeline: ${currentLeadData.timeline || 'Unknown'}` : 
        "No prior lead data.";

      const systemPrompt = `
You are the OrbitLead AI Sales Assistant. Your goal is to move the user through this structured flow:
1. Collect Required Data (name, company, teamSize, budget, timeline)
2. Qualify & Suggest Plan
3. Book Demo (if intent shown)
4. End Conversation Cleanly

REQUIRED FIELDS: name, company, teamSize, budget, timeline.

LOGIC RULES:
- MEMORY AWARENESS: ${leadSummary}. NEVER ask for a field already known.
- STOP ASKING RULE: Once you have at least 3 key fields (teamSize, budget, timeline), STOP asking questions. Move to plan suggestion.
- PLAN SUGGESTION: Suggest ONLY based on budget:
  * Budget < ₹${sp}: Starter Plan (₹${sp.toLocaleString('en-IN')}/mo)
  * Budget between ₹${sp} & ₹${gp}: Growth Plan (₹${gp.toLocaleString('en-IN')}/mo)
  * Budget > ₹${gp}: Enterprise Plan (₹${ep.toLocaleString('en-IN')}/mo)
- BOOKING TRIGGER: If user expresses intent to "book", "schedule", "demo", "meeting", "call":
  * IF data missing: Ask ONLY for the specific missing fields.
  * IF sufficient data (teamSize, budget, timeline): Set "action": "booked" and confirm.
- CONVERSATION END: After booking, summarize the lead, confirm the booking, and DO NOT ask more questions.
- BE CONCISE: Avoid generic questions like "tell me more about your company". Use the user's name.

Return ONLY JSON:
{
  "reply": "your concise message",
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
      return Response.json({ 
        reply: "AI is temporarily unavailable. Please try again." 
      }, { status: 503 });
    }

    // 6. Parse AI Response safely
    let parsedAI;
    try {
      parsedAI = JSON.parse(aiResponseContent);
    } catch (parseError) {
      console.error("[API] Error parsing AI response:", aiResponseContent);
      return Response.json({ 
        reply: "I encountered a formatting error. Could you repeat that?" 
      });
    }

    const { reply, extracted_data, action } = parsedAI;

    // 7. Process Lead Data safely
    if (extracted_data && conversationId) {
      trace("Firestore Lead Update Started");
      try {
        const budgetNum = Number(String(extracted_data.budget || currentLeadData?.budget || 0).replace(/[^0-9.-]+/g,"")) || 0;
        const teamNum = parseInt(String(extracted_data.teamSize || currentLeadData?.teamSize || 0), 10) || 0;
        const timelineStr = String(extracted_data.timeline || currentLeadData?.timeline || '');
        const newScore = calculateScore(budgetNum, teamNum, timelineStr);
        
        let calculatedStage: LeadStage = currentLeadData?.stage || 'new';
        if (newScore >= 40 && calculatedStage === 'new') calculatedStage = 'qualified';
        if (action === 'booked') calculatedStage = 'booked';

        const leadData = {
          name: extracted_data.name || currentLeadData?.name || 'Visitor',
          company: extracted_data.company || currentLeadData?.company || 'Unknown',
          teamSize: teamNum,
          budget: budgetNum,
          timeline: timelineStr,
          score: newScore,
          stage: calculatedStage,
          updatedAt: Date.now()
        };

        const existingLeadId = convSnap?.data()?.leadId;
        if (existingLeadId) {
          await updateDoc(doc(db, 'leads', existingLeadId), leadData);
        } else if (Object.values(extracted_data).some(v => v && v !== false)) {
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
    return Response.json({ reply: reply || "I'm here to help!" });

  } catch (fatalError: any) {
    console.error("[API] FATAL ERROR:", fatalError);
    return Response.json({ 
      reply: "A server error occurred. Please refresh and try again." 
    }, { status: 500 });
  }
}

