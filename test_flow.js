/**
 * Test script to simulate the OrbitLead AI Agent flow.
 * Run with: node test_flow.js
 */
const fetch = require('node-fetch');

async function testFlow() {
  console.log("🚀 Starting OrbitLead AI Robustness Test...");
  
  const API_URL = "http://localhost:3000/api/chatTurn"; // Make sure your dev server is running
  let conversationId = "test-conv-" + Date.now();
  
  const turns = [
    "Hi, I’m Kunal from SalesOrbit. We have a team of 16 people and we’re looking for a better way to manage leads and automate our follow-ups.",
    "We’re looking for a solution that can centralize everything, automate follow-ups, and give us better visibility into our pipeline.",
    "I’ve already shared those details — I’m Kunal from SalesOrbit. Could you suggest a plan and a demo?"
  ];

  for (let i = 0; i < turns.length; i++) {
    console.log(`\n--- Turn ${i + 1} ---`);
    console.log(`User: "${turns[i]}"`);
    
    try {
      const res = await fetch(API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: turns[i], conversationId })
      });
      
      const data = await res.json();
      console.log(`Assistant: "${data.reply}"`);
      console.log(`State: ${JSON.stringify(data.state)}`);
      
      if (i === 1) {
        // After turn 2, Kunal and SalesOrbit should STILL be in state
        if (data.state.name === 'Kunal' && data.state.company === 'SalesOrbit') {
          console.log("✅ STATE PRESERVED in Turn 2");
        } else {
          console.log("❌ STATE LOST in Turn 2!");
        }
      }
      
      if (i === 2) {
        if (data.state.name === 'Kunal' && data.state.company === 'SalesOrbit') {
          console.log("✅ STATE PRESERVED in Turn 3 (Frustration test)");
        } else {
          console.log("❌ STATE LOST in Turn 3!");
        }
      }
    } catch (e) {
      console.error("Fetch error:", e.message);
    }
  }
}

testFlow();
