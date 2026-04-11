/**
 * @panelai/core
 *
 * Core multi-agent infrastructure: base agent class, A2A protocol,
 * memory system, and shared tools. Other packages build on top of this.
 */

// Base agent class
export {
  CoreAgent,
  type CoreAgentEnv,
  type AgentNotification,
  type DelegationMessage
} from "./base-agent.js";

// A2A protocol
export * from "./a2a/index.js";

// Memory system
export * from "./memory/index.js";
