/**
 * A2A module exports
 */

export {
  createDefaultAgentCard,
  registerAgentCard,
  unregisterAgentCard,
  getAgentCard,
  getAgentCardByRole,
  getAllAgentCards,
  getAgentCardsByCapability,
  agentHasCapability,
  initializeDefaultAgents,
  clearAgentRegistry
} from "./agent-card.js";

export {
  createTask,
  getTask,
  getTaskWithHistory,
  transitionTask,
  startTask,
  requestInput,
  provideInput,
  completeTask,
  failTask,
  cancelTask,
  getTasksByContext,
  getTasksByAssignee,
  getTasksByState,
  getTasksAwaitingInput,
  clearAllTasks,
  deleteTask
} from "./task-manager.js";

export {
  getAgentStub,
  delegateToAgent,
  notifyAgent,
  broadcastToRole,
  type DelegationRequest,
  type DelegationResult
} from "./delegation.js";
