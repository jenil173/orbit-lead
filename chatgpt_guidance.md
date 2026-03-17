# OrbitLead Prototype - ChatGPT Guidance Document

## Project Overview
OrbitLead is a minimal but professional AI SaaS prototype. It acts as an AI Sales Assistant that chats with website visitors, extracts lead information (name, company, team size, budget, timeline), scores the leads based on their data, and displays them in a pipeline dashboard for the sales team.

**Tech Stack:**
- **Framework:** Next.js 14 (App Router)
- **Styling:** Tailwind CSS + shadcn/ui components (Lucide icons)
- **Database & Auth:** Firebase (Firestore & Firebase Auth)
- **AI Integration:** Groq API (LLaMA 3 model)

## Current State (What's Completed)
1.  **Authentication (`/login`):** Basic login UI with Firebase Auth context (`AuthContext.tsx`).
2.  **AI Chat System (`/chat` & `/api/chatTurn`):**
    - Conversational UI.
    - System prompt instructs the AI to qualify leads and suggest pricing based on `pricing_config.json`.
    - API automatically parses the AI's JSON output to extract lead metrics (budget, team size, timeline).
    - API scores the lead (0-100) and saves/updates it in Firestore (`leads` collection).
3.  **Pipeline Dashboard (`/dashboard`):**
    - A Kanban-style board fetching leads from Firestore in real-time (`onSnapshot`).
    - Leads are categorized into stages: New, Qualified, Proposal Sent, Demo Booked, Won, Lost.
    - Displays lead score, budget, and team size.

---

## 🛑 Incomplete Steps (What Needs to be Built Next)

If you are continuing this project, please tackle the following incomplete features in order:

### 1. Interactive Kanban Board (Drag & Drop)
**Problem:** The Dashboard (`app/dashboard/page.tsx`) currently only *displays* leads in columns based on their `stage`. Users cannot move leads between stages.
**Goal:** Implement drag-and-drop functionality so users can drag a lead card from "New" to "Qualified" or "Closed Won".
**Guidance for ChatGPT:**
- "Help me integrate `@dnd-kit/core` or `react-beautiful-dnd` into `app/dashboard/page.tsx`."
- "Write the Firebase `updateDoc` logic to change a lead's `stage` when dropped into a new column."

### 2. Lead Detail Modal & Editing
**Problem:** Clicking on a lead card in the Dashboard currently does nothing.
**Goal:** When a lead card is clicked, open a Shadcn Dialog/Modal showing the lead's full details and the conversation history that generated the lead.
**Guidance for ChatGPT:**
- "Create a `LeadDetailModal` component that fetches the conversation history using the lead's `conversationId`."
- "Allow the user to manually edit lead details (name, budget, etc.) and save changes to Firestore."

### 3. Actual Demo Booking Execution
**Problem:** The AI chat suggests times for a demo (e.g., "Monday 10AM"), but there is no system to actually lock this in.
**Goal:** Create a functional booking flow. If the user agrees to a time, the AI should trigger an action to save the booking and change the lead's stage to `booked`.
**Guidance for ChatGPT:**
- "Update the `/api/chatTurn` system prompt to output a `booking_confirmed: boolean` flag in its JSON."
- "If `booking_confirmed` is true, update the lead's stage in Firestore to `booked` and save the timestamp."

### 4. API Security & Auth Validation
**Problem:** The `/api/chatTurn` route trusts the `userId` passed from the client in the JSON body. This could be spoofed.
**Goal:** Secure the API route by securely verifying the user's identity.
**Guidance for ChatGPT:**
- "Help me implement Firebase Admin SDK to verify the Bearer token in Next.js API routes."
- "Refactor `/api/chatTurn` to read the Authorization header, decode the Firebase ID Token, and ensure the user is authenticated before writing to Firestore."

### 5. Settings / Pricing UI
**Problem:** Pricing is hardcoded in `pricing_config.json`, meaning non-developers cannot change the AI's pricing suggestions.
**Goal:** Create an Admin Settings page to store and manage pricing plans in Firestore instead of a static JSON file.
**Guidance for ChatGPT:**
- "Create a `/dashboard/settings` page to allow admins to edit Starter, Growth, and Enterprise pricing."
- "Refactor `/api/chatTurn` to fetch the pricing from Firestore instead of `pricing_config.json`."

---
**How to use this file:**
Copy any of the "Guidance for ChatGPT" prompts above and paste them into ChatGPT along with the relevant file code (e.g., `app/dashboard/page.tsx` or `app/api/chatTurn/route.ts`) to get immediate, context-aware help!
