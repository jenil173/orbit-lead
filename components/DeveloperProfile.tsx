"use client";

import React from "react";
import { Github, Linkedin, Instagram, Code2 } from "lucide-react";

export function DeveloperProfile() {
  return (
    <div className="flex flex-col items-center sm:flex-row sm:justify-between py-3 px-6 border-t border-slate-200 bg-white/50 backdrop-blur-sm mt-auto w-full">
      <div className="flex items-center space-x-2 mb-2 sm:mb-0">
        <div className="p-1.5 rounded-lg bg-indigo-50 text-indigo-600">
          <Code2 size={14} />
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] uppercase tracking-wider font-bold text-slate-400 leading-none mb-0.5">Developer</span>
          <span className="text-sm font-semibold text-slate-700 leading-none">Jenil Gajipara</span>
        </div>
      </div>

      <div className="flex items-center space-x-4">
        <a
          href="https://github.com/jenil173"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
          aria-label="GitHub"
          title="View GitHub profile"
        >
          <Github size={18} />
        </a>

        <a
          href="https://www.linkedin.com/in/jenil-gajipara"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
          aria-label="LinkedIn"
          title="Connect on LinkedIn"
        >
          <Linkedin size={18} />
        </a>

        <a
          href="https://www.instagram.com/jenil_gajipara"
          target="_blank"
          rel="noopener noreferrer"
          className="text-slate-400 hover:text-indigo-600 transition-colors p-1"
          aria-label="Instagram"
          title="Follow on Instagram"
        >
          <Instagram size={18} />
        </a>
      </div>
    </div>
  );
}
