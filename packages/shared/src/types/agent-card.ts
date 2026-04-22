/**
 * Agent Card - A2A-inspired agent metadata
 *
 * Each agent publishes an Agent Card describing its identity,
 * capabilities, and configuration. Used for discovery and routing.
 */

/** Capability that an agent can perform */
export interface AgentCapability {
  /** Unique identifier for the capability */
  name: string;
  /** Human-readable description */
  description: string;
  /** JSON schema for expected input (optional) */
  inputSchema?: Record<string, unknown>;
  /** JSON schema for expected output (optional) */
  outputSchema?: Record<string, unknown>;
}

/** Voice configuration for TTS */
export interface VoiceConfig {
  /** TTS voice ID (e.g., Deepgram voice model) */
  voiceId: string;
  /** Speaking rate multiplier (1.0 = normal) */
  speakingRate?: number;
  /** Pitch adjustment */
  pitch?: number;
}

/** Personality traits that influence agent behavior */
export interface PersonalityConfig {
  /** Agent's communication style */
  style: "formal" | "casual" | "technical" | "friendly";
  /** Tone descriptors */
  traits: string[];
  /** Custom system prompt additions */
  systemPromptAdditions?: string;
}

/** Agent Card - full agent metadata */
export interface AgentCard {
  /** Unique agent identifier */
  id: string;
  /** Human-readable name */
  name: string;
  /** Agent role/type */
  role: AgentRole;
  /** What this agent does */
  description: string;
  /** Version of this agent */
  version: string;
  /** List of capabilities this agent provides */
  capabilities: AgentCapability[];
  /** Voice configuration for TTS */
  voice?: VoiceConfig;
  /** Personality configuration */
  personality?: PersonalityConfig;
  /** Whether this agent requires human approval for its outputs */
  requiresApproval: boolean;
  /** Tags for categorization */
  tags?: string[];
  /** When this card was last updated */
  updatedAt: string;
}

/** Agent roles in the system */
export type AgentRole =
  | "orchestrator"
  | "recruiter"
  | "technical"
  | "culture"
  | "domain-expert"
  | "behavioral"
  | "bias-audit"
  | "jarvis";

/** Minimal agent reference for cross-agent communication */
export interface AgentRef {
  id: string;
  name: string;
  role: AgentRole;
}
