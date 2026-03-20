import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Lead, Message } from "@/types"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Loader2, User, Bot, MessageCircle } from "lucide-react"

export function LeadDetailModal({ 
  lead, 
  isOpen, 
  onClose,
  onUpdate
}: { 
  lead: Lead | null; 
  isOpen: boolean; 
  onClose: () => void;
  onUpdate: (updatedLead: Lead) => void;
}) {
  const [messages, setMessages] = useState<Message[]>([])
  const [loadingHistory, setLoadingHistory] = useState(false)
  const [saving, setSaving] = useState(false)
  const [hasLoadedInitial, setHasLoadedInitial] = useState(false)
  const messagesEndRef = useRef<HTMLDivElement>(null)
  const prevMessagesCount = useRef(0)

  const scrollToBottom = () => {
    if (messagesEndRef.current) {
      messagesEndRef.current.scrollIntoView({ behavior: "smooth" });
    }
  }

  // Reset flag when closed
  useEffect(() => {
    if (!isOpen) {
      setHasLoadedInitial(false);
      prevMessagesCount.current = 0;
    }
  }, [isOpen]);

  // Handle controlled scrolling
  useEffect(() => {
    if (isOpen && !loadingHistory && messages.length > 0) {
      // First time loading history - record count but DON'T scroll (shows top)
      if (!hasLoadedInitial) {
        setHasLoadedInitial(true);
        prevMessagesCount.current = messages.length;
        return;
      }
      
      // Scroll ONLY when new messages are added
      if (messages.length > prevMessagesCount.current) {
        scrollToBottom();
        prevMessagesCount.current = messages.length;
      }
    }
  }, [messages, isOpen, loadingHistory, hasLoadedInitial])
  
  // editable fields
  const [formData, setFormData] = useState<Partial<Lead>>({})

  useEffect(() => {
    if (lead && isOpen) {
      setFormData({
        name: lead.name,
        company: lead.company,
        budget: lead.budget,
        teamSize: lead.teamSize,
        timeline: lead.timeline,
      })
      if (lead.conversationId) {
        fetchConversation(lead.conversationId)
      } else {
        setMessages([])
      }
    }
  }, [lead, isOpen])

  const fetchConversation = async (convId: string) => {
    setLoadingHistory(true)
    try {
      const convSnap = await getDoc(doc(db, "conversations", convId))
      if (convSnap.exists()) {
        setMessages(convSnap.data().messages || [])
      }
    } catch (error) {
      console.error("Failed to load conversation", error)
    } finally {
      setLoadingHistory(false)
    }
  }

  const handleSave = async () => {
    if (!lead) return
    
    // Safety check - prevent empty or invalid updates
    if (!formData.name?.trim() || !formData.company?.trim()) {
      alert("Name and Company are required.");
      return;
    }

    setSaving(true)
    try {
      const updatedData = {
        name: formData.name.trim(),
        company: formData.company.trim(),
        budget: Number(formData.budget) || 0,
        teamSize: Number(formData.teamSize) || 0,
        timeline: formData.timeline || '',
      }

      const leadRef = doc(db, "leads", lead.id)
      await updateDoc(leadRef, updatedData)
      
      const updatedLead = { ...lead, ...updatedData } as Lead;
      onUpdate(updatedLead)
      onClose()
    } catch (error) {
      console.error("Failed to update lead", error)
      alert("Failed to save changes. Please try again.")
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-5xl h-[90vh] md:h-[80vh] flex flex-col p-0 overflow-hidden shadow-2xl border-none">
        <div className="flex flex-col md:flex-row flex-1 overflow-hidden">
          
          {/* Left Side - Edit Form */}
          <div className="flex-1 overflow-y-auto p-6 space-y-4">
            <DialogHeader>
              <DialogTitle>Lead Details</DialogTitle>
              <DialogDescription>
                Review and update lead information.
              </DialogDescription>
            </DialogHeader>
            <div className="space-y-4 py-4">
              <div className="space-y-2">
                <Label>Name</Label>
                <Input 
                  value={formData.name || ''} 
                  onChange={(e) => setFormData({...formData, name: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <Label>Company</Label>
                <Input 
                  value={formData.company || ''} 
                  onChange={(e) => setFormData({...formData, company: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <Label>Budget</Label>
                <Input 
                  type="number"
                  value={formData.budget || ''} 
                  onChange={(e) => setFormData({...formData, budget: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <Label>Team Size</Label>
                <Input 
                  type="number"
                  value={formData.teamSize || ''} 
                  onChange={(e) => setFormData({...formData, teamSize: e.target.value})} 
                />
              </div>
              <div className="space-y-2">
                <Label>Timeline</Label>
                <Input 
                  value={formData.timeline || ''} 
                  onChange={(e) => setFormData({...formData, timeline: e.target.value})} 
                />
              </div>
            </div>
            <DialogFooter className="mt-4">
              <Button variant="outline" onClick={onClose} disabled={saving}>Cancel</Button>
              <Button onClick={handleSave} disabled={saving} className="bg-indigo-600 hover:bg-indigo-700">
                {saving && <Loader2 className="w-4 h-4 mr-2 animate-spin" />}
                Save Changes
              </Button>
            </DialogFooter>
          </div>

          {/* Right Side - Chat History */}
          <div className="flex-1 bg-slate-50/50 border-l border-slate-200 flex flex-col h-full overflow-hidden shrink-0 w-full md:max-w-[400px]">
            <div className="p-4 bg-white border-b border-slate-200 shadow-sm z-10 sticky top-0 flex items-center space-x-2">
              <MessageCircle className="w-5 h-5 text-indigo-600" />
              <h3 className="font-bold text-slate-800 text-sm tracking-tight">Conversation</h3>
            </div>
            
            <div className="flex-1 overflow-y-auto p-4 space-y-6">
              {loadingHistory ? (
                <div className="flex items-center justify-center h-full">
                  <div className="flex flex-col items-center space-y-2">
                    <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                    <p className="text-xs text-slate-400 font-medium">Loading history...</p>
                  </div>
                </div>
              ) : messages.length > 0 ? (
                <div className="flex flex-col space-y-6">
                  {messages.filter(m => m.role !== 'system').map((msg, idx) => (
                    <div key={idx} className={`flex w-full ${msg.role === 'assistant' ? 'justify-start' : 'justify-end'}`}>
                      <div className={`flex max-w-[85%] ${msg.role === 'assistant' ? 'flex-row' : 'flex-row-reverse'} items-end gap-2`}>
                        {/* Avatar */}
                        <div className={`w-8 h-8 rounded-full flex-shrink-0 flex items-center justify-center shadow-sm ${
                          msg.role === 'assistant' ? 'bg-white border border-slate-200 text-indigo-600' : 'bg-indigo-600 text-white'
                        }`}>
                          {msg.role === 'assistant' ? <Bot size={14} /> : <User size={14} />}
                        </div>

                        {/* Bubble */}
                        <div className={`flex flex-col ${msg.role === 'assistant' ? 'items-start' : 'items-end'}`}>
                          <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed shadow-sm ${
                            msg.role === 'assistant' 
                              ? 'bg-white text-slate-800 border border-slate-200 rounded-bl-sm' 
                              : 'bg-indigo-600 text-white rounded-br-sm'
                          }`}>
                            <p className="whitespace-pre-wrap">{msg.content}</p>
                          </div>
                          <span className="text-[10px] text-slate-400 mt-1 font-medium px-1">
                            {msg.role === 'assistant' ? 'Orbit AI' : 'Customer'}
                          </span>
                        </div>
                      </div>
                    </div>
                  ))}
                  <div ref={messagesEndRef} className="h-2" />
                </div>
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-center p-8">
                  <div className="w-12 h-12 bg-slate-100 rounded-full flex items-center justify-center mb-3">
                    <MessageCircle className="w-6 h-6 text-slate-300" />
                  </div>
                  <p className="text-sm text-slate-500 font-medium">No conversation history</p>
                  <p className="text-xs text-slate-400 mt-1">Lead hasn't messaged yet.</p>
                </div>
              )}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}
