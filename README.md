# OrbitLead – AI Sales Assistant

"An AI-powered sales assistant that qualifies leads, suggests plans, and books demos automatically."

---

## 👨‍💻 Developer Info

Developed by **Jenil Gajipara**  


---

## 🚀 Project Overview

**OrbitLead** is a modern SaaS prototype designed to automate the initial stages of the sales funnel. Instead of forcing users to fill out long, static forms, OrbitLead uses an interactive **AI-powered Chatbot** to engage visitors naturally.

The AI qualifies the lead by extracting key business data, scores them based on their potential value, suggests localized pricing plans (INR), and can even confirm demo bookings—all without human intervention. This project demonstrates how LLMs can replace manual lead qualification, saving sales teams hours of work and improving conversion efficiency.

---

## ✨ Features

- **AI Chat-based Lead Qualification**: Interactive conversation to collect lead details.
- **Lead Data Extraction**: Intelligent extraction of name, company, team size, budget, and timeline.
- **Automatic Lead Scoring**: Leads are scored based on budget and requirements.
- **Pricing Suggestions**: AI suggests tailored pricing plans (Starter, Growth, Enterprise) in INR.
- **Demo Booking System**: Automatic scheduling logic triggered by the AI.
- **Lead Pipeline Dashboard**: A professional Kanban-style board to track lead stages.
- **Real-time Synchronization**: Pipeline updates instantly using Firebase listeners.
- **Firebase Integration**: Robust Authentication (Google) and Firestore database management.

---

## 🛠 Tech Stack

**Frontend:**
- **Next.js 14** (App Router)
- **TypeScript**
- **TailwindCSS** (Styling)
- **ShadCN UI** (Modern Components)

**Backend:**
- **Firebase Auth** (Authentication)
- **Firestore** (NoSQL Database)
- **Firebase Admin SDK** (Secure Backend Validation)

**AI Engine:**
- **Groq API** (Llama 3.1 8B Instant)

---

## 📂 Folder Structure

```text
/app         # Next.js routes, pages, and API handlers
/components  # Reusable UI components (Modals, Forms, Kanban)
/lib         # Configuration (Firebase, Groq, Admin SDK)
/types       # TypeScript interfaces and definitions
```

---

## ⚙️ Setup Instructions

Follow these steps to run the project locally:

1. **Clone the repository:**
   ```bash
   git clone https://github.com/jenil173/orbit-lead.git
   cd orbit-lead
   ```

2. **Install dependencies:**
   ```bash
   npm install
   ```

3. **Create .env.local file:**
   Create a file named `.env.local` in the root directory.

4. **Add environment variables:**
   Paste the following into your `.env.local` and fill in your keys:
   ```env
   # Firebase Config
   NEXT_PUBLIC_FIREBASE_API_KEY=your_api_key
   NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN=your_auth_domain
   NEXT_PUBLIC_FIREBASE_PROJECT_ID=your_project_id
   NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET=your_storage_bucket
   NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID=your_sender_id
   NEXT_PUBLIC_FIREBASE_APP_ID=your_app_id

   # AI Config
   GROQ_API_KEY=your_groq_key

   # Service Account (Backend Security)
   FIREBASE_CLIENT_EMAIL=your_admin_email
   FIREBASE_PRIVATE_KEY="your_private_key_string"
   ```

5. **Run the project:**
   ```bash
   npm run dev
   ```

6. **Open in browser:**
   Go to [http://localhost:3000](http://localhost:3000)

7. **Important: Authorize your Deployment Domain**
   If you deploy to a service like Vercel, you *must* add your production domain to the Firebase console:
   - Go to **Firebase Console** > **Authentication** > **Settings** > **Authorized domains**.
   - Click **Add domain** and enter your deployment URL (e.g., `orbit-lead.vercel.app`).

---

### **Demo Chat Guide (Copy & Paste to Test)**

| Feature | What to Type | AI Expected Behavior |
| :--- | :--- | :--- |
| **Qualification** | "Hi, I'm Rohan from LeadSphere. We have 30 people and need automation." | Extracts Name, Company, Team Size. Moves to **Qualified**. |
| **Pricing** | "What are your plans? Our budget is ₹1,00,000." | Suggests **Growth Plan** (INR). Moves to **Proposed**. |
| **Demo Booking** | "I'd like a demo on Friday at 2 PM." | Confirms time. Moves to **Demo Booked**. |
| **Closing** | "Sounds great, we are ready to proceed with the purchase." | Professional closing. Moves to **Closed**. |

---

## 🎮 Demo Flow (For Evaluators)

1. **Login**: Authenticate using the Google Login button.
2. **Chat**: Click "Open AI Chat" and engage the agent with the Test Scenarios.
3. **Data Verification**: Click on a Lead Card in the Dashboard to see real-time data extraction.
4. **Settings**: Go to `/dashboard/settings` and change the prices—then chat again to see the AI reflect them instantly.
5. **Dashboard**: Drag and drop leads across columns to see the visual pipeline management.

---

## 🔐 Firebase Security

- **Firestore Security Rules**: Rules are configured to require user authentication for all reads/writes.
- **Environment Protection**: All sensitive API keys and Private Keys are stored in `.env.local` and never committed to the repository.
- **Backend Validation**: Every AI request is validated server-side using the Firebase Admin SDK to verify the user's Auth token.

---

## 🧠 AI Usage

- **Lead Extraction**: The AI replaces static forms by capturing data through conversation.
- **Dynamic Pricing**: AI reads current prices from the database so it never "hallucinates" old or incorrect pricing.
- **Strategic Flow**: Logic is built to prioritize high-value leads for demos while educating smaller leads.

---

## 📈 Future Improvements

- **Real Calendar Integration**: Connect to Google Calendar/Calendly for actual scheduling.
- **Advanced Evaluation**: Use Multi-Agent systems for more complex lead grading.
- **Analytics**: Visualization of conversion rates across the pipeline.
- **CRM Export**: One-click export to Salesforce or HubSpot.

---

## 📌 Conclusion

This project demonstrates how AI can automate sales workflows, eliminate boring forms, and significantly improve lead conversion efficiency through natural conversation.

Developed with ❤️ by **Jenil Gajipara**
