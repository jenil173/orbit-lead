export type LeadStage = 'new' | 'qualified' | 'proposal_sent' | 'booked' | 'won' | 'lost';

export interface Lead {
  id: string;
  name: string;
  company: string;
  teamSize: number | string;
  budget: number | string;
  timeline: string;
  score: number;
  stage: LeadStage;
  createdAt: number;
  conversationId?: string;
}

export type Role = 'user' | 'assistant' | 'system';

export interface Message {
  role: Role;
  content: string;
}

export interface Conversation {
  id: string;
  userId: string;
  messages: Message[];
  createdAt: number;
  updatedAt: number;
}

export interface LeadExtraction {
  name?: string;
  company?: string;
  teamSize?: string | number;
  budget?: string | number;
  timeline?: string;
}
