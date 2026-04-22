/**
 * Agent role constants and metadata
 */

import type { AgentRole } from "../types/agent-card.js";

/** All available agent roles */
export const AGENT_ROLES: readonly AgentRole[] = [
  "orchestrator",
  "recruiter",
  "technical",
  "culture",
  "domain-expert",
  "behavioral",
  "bias-audit",
  "jarvis"
] as const;

/** Agent role display names */
export const AGENT_ROLE_NAMES: Record<AgentRole, string> = {
  orchestrator: "Orchestrator",
  recruiter: "Recruiter",
  technical: "Technical Interviewer",
  culture: "Culture & Values",
  "domain-expert": "Domain Expert",
  behavioral: "Behavioral Interviewer",
  "bias-audit": "Bias Auditor",
  jarvis: "Jarvis"
} as const;

/** Agent role descriptions */
export const AGENT_ROLE_DESCRIPTIONS: Record<AgentRole, string> = {
  orchestrator:
    "Coordinates the interview panel, manages phase transitions, and synthesizes final recommendations.",
  recruiter:
    "Handles pre-interview pipeline: resume parsing, candidate scoring, shortlist generation.",
  technical:
    "Evaluates technical skills, coding ability, and system design knowledge.",
  culture:
    "Assesses culture fit, communication style, and alignment with company values.",
  "domain-expert": "Probes domain-specific expertise relevant to the role.",
  behavioral:
    "Assesses behavioral signals using evidence-backed STAR-style probing and reflection.",
  "bias-audit":
    "Silent observer that reviews panel output for proxy-language, score divergence, and strengths contradictions.",
  jarvis: "General-purpose voice assistant."
} as const;

/** Default voice IDs for each agent role (Deepgram voices) */
export const DEFAULT_VOICE_IDS: Record<AgentRole, string> = {
  orchestrator: "aura-asteria-en", // Professional female
  recruiter: "aura-luna-en", // Friendly female
  technical: "aura-orion-en", // Technical male
  culture: "aura-stella-en", // Warm female
  "domain-expert": "aura-arcas-en", // Authoritative male
  behavioral: "aura-athena-en", // Analytical female
  "bias-audit": "aura-asteria-en", // Neutral (silent observer, rarely speaks)
  jarvis: "aura-asteria-en" // Default
} as const;

/** Interview panel agent roles (excludes orchestrator and jarvis) */
export const PANEL_AGENT_ROLES: readonly AgentRole[] = [
  "technical",
  "culture",
  "domain-expert",
  "behavioral"
] as const;
