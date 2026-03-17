"use client";

import { useState, useRef, useEffect } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { collection, addDoc, doc, updateDoc, arrayUnion, getDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Message } from "@/types";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Loader2, Send } from "lucide-react";

export default function ChatPage() {
  const { user, loading } = useAuth();
  const router = useRouter();
  
  const [messages, setMessages] = useState<Message[]>([
    { role: "assistant", content: "Hi there! I'm the OrbitLead AI Assistant. How can I help you today?" }
  ]);
  const [input, setInput] = useState("");
  const [isTyping, setIsTyping] = useState(false);
  const [conversationId, setConversationId] = useState<string | null>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (scrollRef.current) {
      // Small timeout to ensure DOM is updated
      setTimeout(() => {
        if (scrollRef.current) {
          scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
        }
      }, 100);
    }
  }, [messages, isTyping]);

  const handleSend = async () => {
    if (!input.trim() || !user) return;

    const userMsg: Message = { role: "user", content: input.trim() };
    setMessages((prev) => [...prev, userMsg]);
    setInput("");
    setIsTyping(true);

    try {
      let currentConvId = conversationId;

      // Create conversation if it doesn't exist
      if (!currentConvId) {
        const docRef = await addDoc(collection(db, "conversations"), {
          userId: user.uid,
          messages: [
            { role: "assistant", content: "Hi there! I'm the OrbitLead AI Assistant. How can I help you today?" },
            userMsg
          ],
          createdAt: Date.now(),
          updatedAt: Date.now()
        });
        currentConvId = docRef.id;
        setConversationId(currentConvId);
      } else {
        // Update existing conversation
        await updateDoc(doc(db, "conversations", currentConvId), {
          messages: arrayUnion(userMsg),
          updatedAt: Date.now()
        });
      }

      // Call API Route
      const idToken = await user.getIdToken();
      const res = await fetch("/api/chatTurn", {
        method: "POST",
        headers: { 
          "Content-Type": "application/json",
          "Authorization": `Bearer ${idToken}`
        },
        body: JSON.stringify({ message: userMsg.content, conversationId: currentConvId, userId: user.uid }),
      });

      if (!res.ok) {
        const errorData = await res.json().catch(() => ({}));
        console.error("API Error Response:", errorData);
        throw new Error(errorData.reply || errorData.error || "Failed to get response");
      }
      
      const data = await res.json();
      const aiMsg: Message = { role: "assistant", content: data.reply };
      
      setMessages((prev) => [...prev, aiMsg]);

    } catch (error: any) {
      console.error("Chat error:", error);
      const errorMessage = error.message || "Sorry, I'm having trouble connecting right now.";
      setMessages((prev) => [...prev, { role: "assistant", content: errorMessage }]);
    } finally {
      setIsTyping(false);
    }
  };

  if (loading || !user) {
    return (
      <div className="flex items-center justify-center min-h-screen bg-slate-50">
        <Loader2 className="w-8 h-8 animate-spin text-indigo-600" />
      </div>
    );
  }

  return (
    <div className="flex flex-col h-[calc(100vh-20px)] max-w-4xl mx-auto p-2 md:p-4 bg-slate-50 overflow-hidden">
      <div className="bg-white rounded-2xl shadow-lg border border-slate-200 flex-1 flex flex-col overflow-hidden">
        {/* Header */}
        <div className="p-4 border-b border-slate-100 flex items-center justify-between bg-white">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-full bg-indigo-100 flex items-center justify-center">
              <span className="text-xl">🚀</span>
            </div>
            <div>
              <h1 className="font-semibold text-slate-800">OrbitLead Assistant</h1>
              <p className="text-xs text-slate-500">Always online</p>
            </div>
          </div>
          <Button variant="ghost" size="sm" onClick={() => router.push("/dashboard")}>
            View Dashboard
          </Button>
        </div>

        {/* Chat Area */}
        <ScrollArea className="flex-1 p-4" ref={scrollRef}>
          <div className="space-y-6 pb-4">
            {messages.map((msg, i) => (
              <div key={i} className={`flex ${msg.role === "user" ? "justify-end" : "justify-start"}`}>
                <div className={`max-w-[80%] rounded-2xl px-5 py-3.5 ${
                  msg.role === "user" 
                    ? "bg-indigo-600 text-white rounded-br-sm shadow-md" 
                    : "bg-slate-100 text-slate-800 rounded-bl-sm border border-slate-200"
                }`}>
                  <p className="text-sm md:text-base leading-relaxed whitespace-pre-wrap">{msg.content}</p>
                </div>
              </div>
            ))}
            {isTyping && (
              <div className="flex justify-start">
                <div className="bg-slate-100 rounded-2xl rounded-bl-sm px-5 py-4 border border-slate-200">
                  <div className="flex space-x-1.5 items-center h-4">
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "0ms" }}></div>
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "150ms" }}></div>
                    <div className="w-2 h-2 rounded-full bg-slate-400 animate-bounce" style={{ animationDelay: "300ms" }}></div>
                  </div>
                </div>
              </div>
            )}
          </div>
        </ScrollArea>

        {/* Input Area */}
        <div className="p-4 bg-white border-t border-slate-100">
          <form 
            onSubmit={(e) => { e.preventDefault(); handleSend(); }}
            className="relative flex items-center"
          >
            <Input 
              value={input}
              onChange={(e) => setInput(e.target.value)}
              placeholder="Type your message..."
              className="pr-12 py-6 rounded-xl border-slate-200 focus-visible:ring-indigo-600 bg-slate-50 text-base"
              disabled={isTyping}
            />
            <Button 
              type="submit" 
              size="icon"
              className="absolute right-2 h-10 w-10 rounded-lg bg-indigo-600 hover:bg-indigo-700 text-white transition-colors"
              disabled={isTyping || !input.trim()}
            >
              <Send className="w-4 h-4" />
            </Button>
          </form>
        </div>
      </div>
    </div>
  );
}
