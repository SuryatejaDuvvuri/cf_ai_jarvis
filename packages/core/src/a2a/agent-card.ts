/**
 * Agent Card Registry
 *
 * Manages agent discovery via Agent Cards.
 * Supports static registration (core agents) and dynamic registration
 * (custom Domain Expert agents).
 */

import type {
  AgentCard,
  AgentRole,
  AgentCapability,
  PersonalityConfig
} from "@panelai/shared";
import {
  AGENT_ROLE_NAMES,
  AGENT_ROLE_DESCRIPTIONS,
  DEFAULT_VOICE_IDS
} from "@panelai/shared";

/** Registry storage */
const agentCards: Map<string, AgentCard> = new Map();

/** Default capabilities by role */
const DEFAULT_CAPABILITIES: Record<AgentRole, AgentCapability[]> = {
  orchestrator: [
    {
      name: "coordinate-interview",
      description: "Coordinate panel interview phases and agent handoffs"
    },
    {
      name: "synthesize-scorecard",
      description: "Combine agent assessments into unified scorecard"
    },
    {
      name: "run-deliberation",
      description: "Facilitate post-interview agent deliberation"
    }
  ],
  recruiter: [
    {
      name: "parse-resume",
      description: "Extract structured data from resume documents"
    },
    {
      name: "score-candidate",
      description: "Score candidate against job requirements"
    },
    {
      name: "generate-shortlist",
      description: "Create ranked candidate shortlist with reasoning"
    },
    {
      name: "prepare-interview-brief",
      description: "Prepare interview brief for panel agents"
    }
  ],
  technical: [
    {
      name: "technical-interview",
      description: "Conduct technical interview segment"
    },
    {
      name: "evaluate-coding",
      description: "Evaluate coding skills and problem-solving"
    },
    {
      name: "evaluate-system-design",
      description: "Evaluate system design abilities"
    }
  ],
  culture: [
    {
      name: "culture-interview",
      description: "Conduct culture fit interview segment"
    },
    {
      name: "evaluate-soft-skills",
      description: "Evaluate communication and collaboration"
    },
    {
      name: "evaluate-values-alignment",
      description: "Assess alignment with company values"
    }
  ],
  "domain-expert": [
    {
      name: "domain-interview",
      description: "Conduct domain expertise interview segment"
    },
    {
      name: "evaluate-domain-knowledge",
      description: "Evaluate depth of domain-specific knowledge"
    },
    {
      name: "query-knowledge-base",
      description: "Query RAG knowledge base for role-specific context"
    }
  ],
  jarvis: [
    {
      name: "general-assistant",
      description: "General-purpose voice assistant"
    },
    {
      name: "schedule-tasks",
      description: "Schedule reminders and tasks"
    }
  ]
};

/** Default personality by role */
const DEFAULT_PERSONALITIES: Record<AgentRole, PersonalityConfig> = {
  orchestrator: {
    style: "formal",
    traits: ["professional", "organized", "clear"],
    systemPromptAdditions:
      "You are the interview coordinator. Be professional and ensure smooth transitions."
  },
  recruiter: {
    style: "friendly",
    traits: ["warm", "efficient", "thorough"],
    systemPromptAdditions:
      "You are the recruiting specialist. Be welcoming but focused on gathering information."
  },
  technical: {
    style: "technical",
    traits: ["analytical", "precise", "curious"],
    systemPromptAdditions:
      "You are the technical interviewer. Be direct, ask probing follow-ups, evaluate depth of knowledge."
  },
  culture: {
    style: "friendly",
    traits: ["empathetic", "observant", "engaging"],
    systemPromptAdditions:
      "You are the culture fit interviewer. Be warm and conversational, use STAR method for behavioral questions."
  },
  "domain-expert": {
    style: "technical",
    traits: ["knowledgeable", "practical", "detailed"],
    systemPromptAdditions:
      "You are the domain expert. Ask role-specific questions based on the job requirements."
  },
  jarvis: {
    style: "casual",
    traits: ["helpful", "witty", "efficient"],
    systemPromptAdditions: "You are Jarvis, a personal AI assistant."
  }
};

/**
 * Create a default Agent Card for a role
 */
export function createDefaultAgentCard(
  role: AgentRole,
  overrides?: Partial<AgentCard>
): AgentCard {
  const now = new Date().toISOString();

  const card: AgentCard = {
    id: overrides?.id ?? `agent-${role}`,
    name: overrides?.name ?? AGENT_ROLE_NAMES[role],
    role,
    description: overrides?.description ?? AGENT_ROLE_DESCRIPTIONS[role],
    version: overrides?.version ?? "1.0.0",
    capabilities: overrides?.capabilities ?? DEFAULT_CAPABILITIES[role],
    voice: overrides?.voice ?? {
      voiceId: DEFAULT_VOICE_IDS[role]
    },
    personality: overrides?.personality ?? DEFAULT_PERSONALITIES[role],
    requiresApproval: overrides?.requiresApproval ?? role === "recruiter",
    tags: overrides?.tags ?? [role],
    updatedAt: overrides?.updatedAt ?? now
  };

  return card;
}

/**
 * Register an agent card
 */
export function registerAgentCard(card: AgentCard): void {
  agentCards.set(card.id, card);
}

/**
 * Unregister an agent card
 */
export function unregisterAgentCard(id: string): boolean {
  return agentCards.delete(id);
}

/**
 * Get an agent card by ID
 */
export function getAgentCard(id: string): AgentCard | undefined {
  return agentCards.get(id);
}

/**
 * Get an agent card by role (returns first match)
 */
export function getAgentCardByRole(role: AgentRole): AgentCard | undefined {
  for (const card of agentCards.values()) {
    if (card.role === role) {
      return card;
    }
  }
  return undefined;
}

/**
 * Get all registered agent cards
 */
export function getAllAgentCards(): AgentCard[] {
  return Array.from(agentCards.values());
}

/**
 * Get agent cards by capability
 */
export function getAgentCardsByCapability(capabilityName: string): AgentCard[] {
  return getAllAgentCards().filter((card) =>
    card.capabilities.some((cap) => cap.name === capabilityName)
  );
}

/**
 * Check if an agent has a specific capability
 */
export function agentHasCapability(
  agentId: string,
  capabilityName: string
): boolean {
  const card = getAgentCard(agentId);
  if (!card) return false;
  return card.capabilities.some((cap) => cap.name === capabilityName);
}

/**
 * Initialize the registry with default core agents
 */
export function initializeDefaultAgents(): void {
  const coreRoles: AgentRole[] = [
    "orchestrator",
    "recruiter",
    "technical",
    "culture",
    "domain-expert"
  ];

  for (const role of coreRoles) {
    const card = createDefaultAgentCard(role);
    registerAgentCard(card);
  }
}

/**
 * Clear all registered agents (for testing)
 */
export function clearAgentRegistry(): void {
  agentCards.clear();
}
