/**
 * @panelai/agents
 *
 * Specialist agent implementations for the PanelAI platform.
 * Each agent is a Durable Object that can handle specific interview roles.
 */

// Export Jarvis (the original voice assistant, now an agent)
export { Chat } from "./jarvis/jarvis.agent.js";

// Future agents will be exported here:
// export { Orchestrator } from "./orchestrator/orchestrator.agent.js";
// export { Recruiter } from "./recruiter/recruiter.agent.js";
// export { TechnicalInterviewer } from "./technical/technical.agent.js";
// export { CultureInterviewer } from "./culture/culture.agent.js";
// export { DomainExpert } from "./domain-expert/domain-expert.agent.js";
