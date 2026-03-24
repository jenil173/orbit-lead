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

interface PlanConfig {
  name: string;
  price: number;
  features: string; // Comma separated for editing
}

interface PricingConfig {
  Starter: PlanConfig;
  Growth: PlanConfig;
  Enterprise: PlanConfig;
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
        const docRef = doc(db, "settings", "pricing");
        const docSnap = await getDoc(docRef);
        
        if (docSnap.exists()) {
          const data = docSnap.data();
          // Normalize data structure if it was the old flat number format
          const normalized: any = {};
          ['Starter', 'Growth', 'Enterprise'].forEach(key => {
            if (typeof data[key] === 'number') {
              normalized[key] = {
                name: key,
                price: data[key],
                features: (defaultPricing as any)[key]?.features?.join(", ") || ""
              };
            } else {
              normalized[key] = {
                ...data[key],
                features: Array.isArray(data[key]?.features) ? data[key].features.join(", ") : (data[key]?.features || "")
              };
            }
          });
          setPricing(normalized as PricingConfig);
        } else {
          // Normalize defaultPricing check (it's an array in json, but we want an object)
          let def: any = {};
          if (Array.isArray(defaultPricing)) {
             // For safety if pricing_config.json is the array format
             ['Starter', 'Growth', 'Enterprise'].forEach(k => {
                def[k] = { name: k, price: k === 'Starter' ? 5000 : k === 'Growth' ? 15000 : 50000, features: "" };
             });
          } else {
             def = defaultPricing;
          }
          setPricing(def as PricingConfig);
        }
      } catch (error) {
        console.error("Error fetching pricing:", error);
        setFetching(false);
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
      // Convert features back to array before saving
      const dataToSave = JSON.parse(JSON.stringify(pricing));
      ['Starter', 'Growth', 'Enterprise'].forEach(key => {
        if (typeof dataToSave[key].features === 'string') {
          dataToSave[key].features = dataToSave[key].features.split(',').map((s: string) => s.trim()).filter(Boolean);
        }
      });

      await setDoc(doc(db, "settings", "pricing"), dataToSave);
      setSuccessMsg("Pricing updated successfully!");
      setTimeout(() => setSuccessMsg(""), 3000);
    } catch (error: any) {
      console.error("Failed to save pricing config:", error);
      alert(`Failed to save configuration: ${error.message || "Unknown error occurred."}`);
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

  const renderPlanFields = (key: keyof PricingConfig, label: string) => {
    if (!pricing) return null;
    return (
      <div className="p-4 border border-slate-200 rounded-lg space-y-4 bg-white">
        <h3 className="font-semibold text-slate-700">{label}</h3>
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="space-y-2">
            <Label htmlFor={`${key}-name`}>Plan Name</Label>
            <Input
              id={`${key}-name`}
              value={pricing[key].name}
              onChange={(e) => setPricing({...pricing, [key]: {...pricing[key], name: e.target.value}})}
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor={`${key}-price`}>Price (₹/mo)</Label>
            <Input
              id={`${key}-price`}
              type="number"
              value={pricing[key].price}
              onChange={(e) => setPricing({...pricing, [key]: {...pricing[key], price: Number(e.target.value)}})}
            />
          </div>
        </div>
        <div className="space-y-2">
          <Label htmlFor={`${key}-features`}>Features (comma separated)</Label>
          <Input
            id={`${key}-features`}
            placeholder="e.g. Lead tracking, Basic CRM, 1 Team member"
            value={pricing[key].features}
            onChange={(e) => setPricing({...pricing, [key]: {...pricing[key], features: e.target.value}})}
          />
        </div>
      </div>
    );
  };

  return (
    <div className="min-h-screen bg-slate-50 flex flex-col items-center py-10 px-4 pb-20">
      <div className="w-full max-w-3xl mb-6">
        <Button variant="ghost" onClick={() => router.push("/dashboard")} className="text-slate-500 hover:text-slate-800 -ml-4">
          <ArrowLeft className="w-4 h-4 mr-2" />
          Back to Dashboard
        </Button>
      </div>

      <Card className="w-full max-w-3xl shadow-sm border-slate-200">
        <CardHeader>
          <CardTitle className="text-2xl text-slate-800">Dynamic Pricing Configuration</CardTitle>
          <CardDescription>
            Configure the plans, prices, and features that the OrbitLead AI will present to users.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-6">
          {renderPlanFields('Starter', 'Starter Plan')}
          {renderPlanFields('Growth', 'Growth Plan')}
          {renderPlanFields('Enterprise', 'Enterprise Plan')}
        </CardContent>
        <CardFooter className="flex justify-between border-t border-slate-100 p-6 sticky bottom-0 bg-white z-10">
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
