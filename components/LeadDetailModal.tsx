import { useState, useEffect, useRef } from "react"
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter, DialogDescription } from "@/components/ui/dialog"
import { Input } from "@/components/ui/input"
import { Label } from "@/components/ui/label"
import { Button } from "@/components/ui/button"
import { Lead, Message } from "@/types"
import { doc, getDoc, updateDoc } from "firebase/firestore"
import { db } from "@/lib/firebase"
import { Loader2 } from "lucide-react"

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
  const scrollContainerRef = useRef<HTMLDivElement>(null)

  const scrollToBottom = () => {
    if (scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = scrollContainerRef.current.scrollHeight;
    }
  }

  useEffect(() => {
    const container = scrollContainerRef.current;
    if (!container) return;

    const observer = new ResizeObserver(() => {
      if (isOpen && !loadingHistory) {
        scrollToBottom();
      }
    });

    observer.observe(container);
    // Also scroll children changes
    for (const child of Array.from(container.children)) {
      observer.observe(child);
    }

    return () => observer.disconnect();
  }, [isOpen, loadingHistory, messages.length]);

  useEffect(() => {
    if (isOpen && !loadingHistory) {
      scrollToBottom();
    }
  }, [isOpen, loadingHistory]);
  
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
    setSaving(true)
    try {
      const leadRef = doc(db, "leads", lead.id)
      await updateDoc(leadRef, formData)
      onUpdate({ ...lead, ...formData } as Lead)
      onClose()
    } catch (error) {
      console.error("Failed to update lead", error)
    } finally {
      setSaving(false)
    }
  }

  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-3xl max-h-[85vh] flex flex-col p-0 overflow-hidden">
        <div className="flex flex-col md:flex-row h-full overflow-hidden">
          
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
          <div className="flex-1 bg-slate-50 border-l border-slate-200 flex flex-col h-full overflow-hidden shrink-0 w-full md:max-w-xs">
            <div className="p-4 bg-white border-b border-slate-200 shadow-sm z-10 sticky top-0">
              <h3 className="font-semibold text-slate-800 text-sm">Conversation History</h3>
            </div>
            
            <div 
              ref={scrollContainerRef}
              className="flex-1 overflow-y-auto p-4 space-y-4"
            >
              {loadingHistory ? (
                <div className="flex items-center justify-center h-full">
                  <Loader2 className="w-6 h-6 animate-spin text-indigo-600" />
                </div>
              ) : messages.length > 0 ? (
                <>
                  {messages.filter(m => m.role !== 'system').map((msg, idx) => (
                    <div key={idx} className={`p-3 rounded-lg text-sm ${
                      msg.role === 'assistant' 
                        ? 'bg-slate-200 text-slate-900 ml-4 rounded-tr-none' 
                        : 'bg-indigo-100 text-indigo-900 mr-4 rounded-tl-none'
                    }`}>
                      <span className="font-semibold text-[10px] uppercase tracking-wide block mb-1 opacity-70">
                        {msg.role === 'assistant' ? 'AI Sales Rep' : 'Visitor'}
                      </span>
                      <p className="whitespace-pre-wrap">{msg.content}</p>
                    </div>
                  ))}
                </>
              ) : (
                <p className="text-sm text-slate-500 italic text-center mt-10">No conversation history available.</p>
              )}
            </div>
          </div>

        </div>
      </DialogContent>
    </Dialog>
  )
}
