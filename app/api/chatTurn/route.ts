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

    // 4. Fetch Conversation History
    let history = [];
    let convSnap;
    try {
      if (conversationId) {
        trace("Firestore History Fetch Started");
        const convRef = doc(db, 'conversations', conversationId);
        convSnap = await getDoc(convRef);
        if (convSnap.exists()) {
          history = convSnap.data().messages || [];
          history = history.slice(-10);
        }
        trace("Firestore History Fetched");
      }
    } catch (historyError) {
      console.error("[API] Error fetching history:", historyError);
    }

    // 5. Initialize Groq & Call AI
    trace("Groq AI Call Started");
    const groq = new Groq({ apiKey: process.env.GROQ_API_KEY?.trim() });
    let aiResponseContent = "";

    try {
      const starterPrice = pricingConfig.Starter.toLocaleString('en-IN');
      const growthPrice = pricingConfig.Growth.toLocaleString('en-IN');
      const enterprisePrice = pricingConfig.Enterprise.toLocaleString('en-IN');

      const systemPrompt = `
You are the OrbitLead AI Sales Assistant. Your goal is to engage the user and extract lead info (name, company, team size, budget, timeline).
Suggest pricing: Starter (₹${starterPrice}), Growth (₹${growthPrice}), Enterprise (₹${enterprisePrice}).

Return ONLY a JSON object with:
{
  "reply": "your message to the user",
  "extracted_data": { "name": "...", "company": "...", "teamSize": number, "budget": number, "timeline": "...", "booking_confirmed": boolean }
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
        model: 'llama-3.1-8b-instant', // Faster model
        temperature: 0.1, // Faster/Deterministic
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

    const { reply, extracted_data } = parsedAI;

    // 7. Process Lead Data safely
    if (extracted_data && conversationId) {
      trace("Firestore Lead Update Started");
      try {
        const budgetNum = Number(String(extracted_data.budget || 0).replace(/[^0-9.-]+/g,"")) || 0;
        const teamNum = parseInt(String(extracted_data.teamSize || 0), 10) || 0;
        const timelineStr = String(extracted_data.timeline || '');
        const newScore = calculateScore(budgetNum, teamNum, timelineStr);
        
        let calculatedStage: LeadStage = newScore >= 40 ? 'qualified' : 'new';
        if (extracted_data.booking_confirmed === true) calculatedStage = 'booked';

        const leadData = {
          name: extracted_data.name || 'Visitor',
          company: extracted_data.company || 'Unknown',
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

