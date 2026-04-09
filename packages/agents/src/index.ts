/**
 * @panelai/agents
 *
 * Specialist agent implementations for the PanelAI platform.
 * Each agent is a Durable Object that can handle specific interview roles.
 */

// Export Jarvis (the original voice assistant, now an agent)
export { Chat } from "./jarvis/jarvis.agent.js";

export { OrchestratorAgent } from "./orchestrator/orchestrator.agent.js";
export { RecruiterAgent } from "./recruiter/recruiter.agent.js";
export { TechnicalInterviewerAgent } from "./technical/technical.agent.js";
export { CultureInterviewerAgent } from "./culture/culture.agent.js";
export { DomainExpertAgent } from "./domain-expert/domain-expert.agent.js";
