export type LeadStage = 'New' | 'Qualified' | 'Proposed' | 'Booked' | 'Completed';

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
  notes?: string;
  demoTime?: string;
  intent?: string;
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
  leadId?: string;
}

export interface PlanConfig {
  name: string;
  price: number;
  features: string[];
}

export interface PricingSettings {
  Starter: PlanConfig;
  Growth: PlanConfig;
  Enterprise: PlanConfig;
}

export interface PricingRule {
  name: string;
  min: number;
  max: number;
}

export interface LeadExtraction {
  name?: string;
  company?: string;
  teamSize?: string | number;
  budget?: string | number;
  timeline?: string;
  demoTime?: string;
  intent?: 'demo' | 'pricing' | 'product_inquiry' | 'other';
}
