"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { doc, getDoc, setDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Card, CardContent, CardHeader, CardTitle, CardDescription, CardFooter } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Loader2, Save, ArrowLeft } from "lucide-react";
import defaultPricing from "@/pricing_config.json";

interface PricingConfig {
  Starter: number;
  Growth: number;
  Enterprise: number;
}

export default function SettingsPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  const [pricing, setPricing] = useState<PricingConfig | null>(null);
  const [fetching, setFetching] = useState(true);
  const [saving, setSaving] = useState(false);
  const [successMsg, setSuccessMsg] = useState("");

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const fetchPricing = async () => {
      try {
        const docRef = doc(db, "config", "pricing");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          setPricing(docSnap.data() as PricingConfig);
        } else {
          // If not exists, use defaults from json
          setPricing(defaultPricing as PricingConfig);
        }
      } catch (error) {
        console.error("Error fetching pricing:", error);
        // Fallback to default pricing on error to prevent broken UI
        setPricing(defaultPricing as PricingConfig);
      } finally {
        setFetching(false);
      }
    };
    
    fetchPricing();
  }, [user]);

  const handleSave = async () => {
    if (!pricing) return;
    setSaving(true);
    setSuccessMsg("");
    
    try {
      await setDoc(doc(db, "config", "pricing"), pricing);
      setSuccessMsg("Pricing updated successfully!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (error) {
      console.error("Failed to save pricing config:", error);
      alert("Failed to save configuration. Please check your connection and try again.");
    } finally {
      setSaving(false);
    }
  };

  if (loading || fetching) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4">
      <div className="w-full max-w-2xl mb-6">
        <Button variant="ghost" onClick={() => router.push("/dashboard")} className="text-slate-500 hover:text-slate-800 -ml-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>

      <Card className="w-full max-w-2xl shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-800">AI Sales Configuration</CardTitle>
          <CardDescription>
            Adjust the pricing packages the OrbitLead AI will suggest to prospects.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          <div className="grid gap-4">
            <div className="space-y-2">
              <Label htmlFor="starter">Starter Plan (₹/mo)</Label>
              <Input
                id="starter"
                type="number"
                value={pricing?.Starter ?? ''}
                onChange={(e) => setPricing(prev => prev ? { ...prev, Starter: Number(e.target.value) } : null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="growth">Growth Plan (₹/mo)</Label>
              <Input
                id="growth"
                type="number"
                value={pricing?.Growth ?? ''}
                onChange={(e) => setPricing(prev => prev ? { ...prev, Growth: Number(e.target.value) } : null)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="enterprise">Enterprise Plan (₹/mo)</Label>
              <Input
                id="enterprise"
                type="number"
                value={pricing?.Enterprise ?? ''}
                onChange={(e) => setPricing(prev => prev ? { ...prev, Enterprise: Number(e.target.value) } : null)}
              />
            </div>
          </div>
        </CardContent>
        <CardFooter className="flex justify-between border-t border-slate-100 p-6">
          <p className="text-sm font-medium text-green-600">{successMsg}</p>
          <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
            {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
            <Save className="w-4 h-4 mr-2" />
            Save Configuration
          </Button>
        </CardFooter>
      </Card>
    </div>
  );
}
