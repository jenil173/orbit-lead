"use client";

import { useState } from "react";
import { signInWithPopup, GoogleAuthProvider } from "firebase/auth";
import { auth } from "@/lib/firebase";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Loader2 } from "lucide-react";

export function LoginForm() {
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  const handleGoogleLogin = async () => {
    try {
      setLoading(true);
      const provider = new GoogleAuthProvider();
      await signInWithPopup(auth, provider);
      router.push("/dashboard");
    } catch (error) {
      console.error("Login failed", error);
    } finally {
      setLoading(false);
    }
  };

  return (
    <Card className="w-full max-w-md mx-auto shadow-xl rounded-2xl border-indigo-100">
      <CardHeader className="text-center space-y-2">
        <CardTitle className="text-2xl font-bold text-slate-800">Welcome to OrbitLead</CardTitle>
        <CardDescription className="text-slate-500">
          Sign in to access your AI Sales Assistant dashboard
        </CardDescription>
      </CardHeader>
      <CardContent>
        <Button 
          className="w-full bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl h-12 text-base font-medium transition-all" 
          onClick={handleGoogleLogin} 
          disabled={loading}
        >
          {loading ? (
            <>
              <Loader2 className="mr-2 h-5 w-5 animate-spin" />
              Signing in...
            </>
          ) : (
             "Sign in with Google"
          )}
        </Button>
      </CardContent>
    </Card>
  );
}
