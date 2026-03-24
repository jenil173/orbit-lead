"use client";

import React from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Github, Linkedin, Instagram, ExternalLink, Code2, Rocket } from "lucide-react";
import { Button } from "@/components/ui/button";

interface DeveloperAboutModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export function DeveloperAboutModal({ isOpen, onClose }: DeveloperAboutModalProps) {
  return (
    <Dialog open={isOpen} onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-md bg-white rounded-2xl border-none shadow-2xl p-0 overflow-hidden">
        <div className="bg-indigo-600 p-8 text-white relative overflow-hidden">
          <div className="relative z-10">
            <div className="w-12 h-12 rounded-xl bg-white/20 backdrop-blur-md flex items-center justify-center mb-4">
              <Rocket className="w-6 h-6 text-white" />
            </div>
            <h2 className="text-2xl font-bold mb-2">OrbitLead AI</h2>
            <p className="text-indigo-100 text-sm leading-relaxed">
              An experimental AI-powered SaaS assistant designed to automate lead qualification and demo booking workflows.
            </p>
          </div>
          {/* Abstract background elements */}
          <div className="absolute top-0 right-0 w-32 h-32 bg-white/10 rounded-full -mr-16 -mt-16 blur-2xl"></div>
          <div className="absolute bottom-0 left-0 w-24 h-24 bg-indigo-400/20 rounded-full -ml-12 -mb-12 blur-xl"></div>
        </div>

        <div className="p-8 space-y-6">
          <div className="space-y-3">
            <div className="flex items-center space-x-2 text-slate-400">
              <Code2 size={16} />
              <span className="text-[10px] uppercase tracking-wider font-bold">Developed By</span>
            </div>
            <div className="flex items-center justify-between">
              <h3 className="text-xl font-bold text-slate-800">Jenil Gajipara</h3>
              <div className="flex items-center space-x-2">
                <a 
                  href="https://github.com/jenil173" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-100"
                  title="GitHub"
                >
                  <Github size={18} />
                </a>
                <a 
                  href="https://www.linkedin.com/in/jenil-gajipara" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-100"
                  title="LinkedIn"
                >
                  <Linkedin size={18} />
                </a>
                <a 
                  href="https://www.instagram.com/jenil_gajipara" 
                  target="_blank" 
                  rel="noopener noreferrer"
                  className="p-2 rounded-lg bg-slate-50 text-slate-500 hover:bg-indigo-50 hover:text-indigo-600 transition-all border border-slate-100"
                  title="Instagram"
                >
                  <Instagram size={18} />
                </a>
              </div>
            </div>
            <p className="text-sm text-slate-500 leading-relaxed">
              Jenil is a full-stack developer focused on building modern web applications and AI-powered tools that solve real-world problems.
            </p>
          </div>

          <div className="pt-4 border-t border-slate-100 flex items-center justify-between">
            <p className="text-[10px] text-slate-400 font-medium">© 2026 OrbitLead AI Project</p>
            <Button variant="ghost" size="sm" className="text-indigo-600 hover:text-indigo-700 hover:bg-indigo-50 h-8 text-xs font-semibold px-0" asChild>
              <a href="https://github.com/jenil173/orbit-lead" target="_blank" rel="noopener noreferrer">
                View Source <ExternalLink size={12} className="ml-1.5" />
              </a>
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
