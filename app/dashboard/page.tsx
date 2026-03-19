"use client";

import { useEffect, useState } from "react";
import { useAuth } from "@/context/AuthContext";
import { useRouter } from "next/navigation";
import { collection, query, onSnapshot, orderBy, doc, updateDoc } from "firebase/firestore";
import { db } from "@/lib/firebase";
import { Lead, LeadStage } from "@/types";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Loader2 } from "lucide-react";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Button } from "@/components/ui/button";
import { DndContext, DragEndEvent, DragOverlay, DragStartEvent, PointerSensor, useSensor, useSensors } from "@dnd-kit/core";
import { useDraggable, useDroppable } from "@dnd-kit/core";
import { LeadDetailModal } from "@/components/LeadDetailModal";

const stages: { id: LeadStage; label: string }[] = [
  { id: "New", label: "New Leads" },
  { id: "Qualified", label: "Qualified" },
  { id: "Proposed", label: "Proposed" },
  { id: "Booked", label: "Demo Booked" },
  { id: "Completed", label: "Closed" },
];

function DroppableColumn({ stage, children, count }: { stage: { id: LeadStage; label: string }, children: React.ReactNode, count: number }) {
  const { setNodeRef } = useDroppable({
    id: stage.id,
  });

  return (
    <div className="w-80 flex flex-col bg-slate-100/50 rounded-xl rounded-t-2xl border border-slate-200 overflow-hidden shrink-0">
      <div className="p-4 border-b border-slate-200 bg-slate-100/80 flex justify-between items-center">
        <h3 className="font-semibold text-slate-700">{stage.label}</h3>
        <Badge variant="secondary" className="bg-white text-slate-600 shadow-sm">
          {count}
        </Badge>
      </div>
      <ScrollArea className="flex-1 p-3" ref={setNodeRef}>
        <div className="space-y-3 pb-4 min-h-[100px]">
          {children}
        </div>
      </ScrollArea>
    </div>
  );
}

function DraggableLeadCard({ lead, onCardClick }: { lead: Lead, onCardClick: (lead: Lead) => void }) {
  const { attributes, listeners, setNodeRef, transform, isDragging } = useDraggable({
    id: lead.id,
    data: { ...lead }
  });

  const style = transform ? {
    transform: `translate3d(${transform.x}px, ${transform.y}px, 0)`,
    opacity: isDragging ? 0.5 : 1,
    zIndex: isDragging ? 999 : 1,
  } : undefined;

  return (
    <div ref={setNodeRef} style={style} {...listeners} {...attributes} className="touch-none" onClick={() => {
      if (!isDragging) onCardClick(lead);
    }}>
      <LeadCardContent lead={lead} />
    </div>
  );
}

function LeadCardContent({ lead }: { lead: Lead }) {
  return (
    <Card className="cursor-grab active:cursor-grabbing hover:shadow-md transition-shadow border-slate-200 shadow-sm">
      <CardHeader className="p-4 pb-2">
        <div className="flex justify-between items-start">
          <CardTitle className="text-base font-semibold text-slate-800">{lead.name}</CardTitle>
          <Badge className={
            lead.score >= 40 ? "bg-green-100 text-green-800 hover:bg-green-100" :
            lead.score >= 20 ? "bg-amber-100 text-amber-800 hover:bg-amber-100" :
            "bg-slate-100 text-slate-800 hover:bg-slate-100"
          }>
            Score: {lead.score}
          </Badge>
        </div>
        <p className="text-sm font-medium text-indigo-600">{lead.company}</p>
      </CardHeader>
      <CardContent className="p-4 pt-0 text-sm text-slate-500 hidden sm:block">
        <div className="grid grid-cols-2 gap-2 mt-2">
          <div>
            <span className="block text-xs text-slate-400">Budget</span>
            <span className="text-slate-700">₹{lead.budget?.toLocaleString('en-IN') || '—'}</span>
          </div>
          <div>
            <span className="block text-xs text-slate-400">Team</span>
            <span className="text-slate-700">{lead.teamSize || '—'}</span>
          </div>
        </div>
      </CardContent>
    </Card>
  );
}

export default function DashboardPage() {
  const { user, loading, logout } = useAuth();
  const router = useRouter();
  const [leads, setLeads] = useState<Lead[]>([]);
  const [fetching, setFetching] = useState(true);
  const [activeLead, setActiveLead] = useState<Lead | null>(null);
  
  // Modal state
  const [isModalOpen, setIsModalOpen] = useState(false);
  const [selectedLead, setSelectedLead] = useState<Lead | null>(null);

  const sensors = useSensors(
    useSensor(PointerSensor, {
      activationConstraint: {
        distance: 5, // minimum drag distance before firing
      },
    })
  );

  useEffect(() => {
    if (!loading && !user) {
      router.push("/login");
    }
  }, [user, loading, router]);

  useEffect(() => {
    if (!user) return;

    const q = query(collection(db, "leads"), orderBy("createdAt", "desc"));
    const unsubscribe = onSnapshot(q, (snapshot) => {
      const fetchedLeads = snapshot.docs.map((doc) => ({
        id: doc.id,
        ...doc.data(),
      })) as Lead[];
      setLeads(fetchedLeads);
      setFetching(false);
    }, (error) => {
      console.error("Error fetching leads:", error);
      setFetching(false);
    });

    return () => unsubscribe();
  }, [user]);

  const handleDragStart = (event: DragStartEvent) => {
    const { active } = event;
    const draggedLead = leads.find((l) => l.id === active.id);
    if (draggedLead) setActiveLead(draggedLead);
  };

  const handleDragEnd = async (event: DragEndEvent) => {
    setActiveLead(null);
    const { active, over } = event;
    if (!over) return; // Dropped outside valid droppable area

    const leadId = active.id as string;
    const newStage = over.id as LeadStage;

    const leadToUpdate = leads.find((l) => l.id === leadId);
    if (!leadToUpdate || leadToUpdate.stage === newStage) return;

    // Optimistically update UI
    setLeads((prev) => 
      prev.map((l) => l.id === leadId ? { ...l, stage: newStage } : l)
    );

    // Update in Firestore
    try {
      const leadRef = doc(db, "leads", leadId);
      await updateDoc(leadRef, { stage: newStage });
    } catch (error) {
      console.error("Error updating lead stage:", error);
      // Revert in case of failure would ideally go here, but onSnapshot handles synchronization eventually.
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
    <div className="min-h-screen bg-slate-50 flex flex-col">
      {/* Navbar */}
      <header className="bg-white border-b border-slate-200 px-6 py-4 flex items-center justify-between sticky top-0 z-10">
        <div className="flex items-center space-x-3">
          <div className="w-8 h-8 rounded-lg bg-indigo-600 flex items-center justify-center shadow-md">
            <svg className="w-5 h-5 text-white" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M13 10V3L4 14h7v7l9-11h-7z" />
            </svg>
          </div>
          <h1 className="text-xl font-bold text-slate-800">Pipeline</h1>
        </div>
        <div className="flex items-center space-x-4">
          <Button variant="outline" onClick={() => router.push("/chat")}>
            Open AI Chat
          </Button>
          <Button variant="outline" onClick={() => router.push("/dashboard/settings")}>
            Settings
          </Button>
          <Button variant="ghost" onClick={logout} className="text-slate-500 hover:text-slate-800">
            Sign out
          </Button>
        </div>
      </header>

      {/* Kanban Board */}
      <main className="flex-1 overflow-x-auto p-6">
        <DndContext sensors={sensors} onDragStart={handleDragStart} onDragEnd={handleDragEnd}>
          <div className="flex gap-6 min-w-max h-[calc(100vh-120px)]">
            {stages.map((stage) => {
              const columnLeads = leads.filter((lead) => lead.stage === stage.id);
              return (
                <DroppableColumn key={stage.id} stage={stage} count={columnLeads.length}>
                  {columnLeads.map((lead) => (
                    <DraggableLeadCard key={lead.id} lead={lead} onCardClick={(l) => { setSelectedLead(l); setIsModalOpen(true); }} />
                  ))}
                  {columnLeads.length === 0 && (
                    <div className="text-center p-8 text-sm text-slate-400 border-2 border-dashed border-slate-200 rounded-xl">
                      Drop leads here
                    </div>
                  )}
                </DroppableColumn>
              );
            })}
          </div>
          
          <DragOverlay>
            {activeLead ? <LeadCardContent lead={activeLead} /> : null}
          </DragOverlay>
        </DndContext>
        
        <LeadDetailModal 
          lead={selectedLead} 
          isOpen={isModalOpen} 
          onClose={() => setIsModalOpen(false)} 
          onUpdate={(updatedLead) => {
            setLeads(prev => prev.map(l => l.id === updatedLead.id ? updatedLead : l));
            setSelectedLead(updatedLead);
          }} 
        />
      </main>
    </div>
  );
}
