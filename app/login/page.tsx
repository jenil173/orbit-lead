export default function LoginPage() {
  return (
    <div className="min-h-screen bg-slate-50 flex items-center justify-center p-4">
      <div className="w-full max-w-5xl grid lg:grid-cols-2 gap-12 items-center">
        {/* Left Side - Brand & Pitch */}
        <div className="hidden lg:flex flex-col space-y-6">
          <div className="flex items-center space-x-3 text-indigo-600">
            <div className="w-10 h-10 rounded-xl bg-indigo-600 flex items-center justify-center shadow-lg">
              <svg className="w-6 h-6 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
              </svg>
            </div>
            <span className="text-2xl font-bold tracking-tight text-slate-900">OrbitLead</span>
          </div>
          <h1 className="text-4xl font-extrabold tracking-tight text-slate-900 leading-tight">
            Deploy an AI Sales Assistant in minutes.
          </h1>
          <p className="text-lg text-slate-600 leading-relaxed max-w-md">
            Engage visitors, extract qualified leads automatically, and book more demos without lifting a finger.
          </p>
        </div>

        {/* Right Side - Login Form */}
        <div className="flex justify-center w-full">
          <LoginForm />
        </div>
      </div>
    </div>
  );
}

import { LoginForm } from "@/components/LoginForm";
