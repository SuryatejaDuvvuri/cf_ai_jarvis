/**
 * @panelai/shared
 *
 * Shared types, constants, and utilities used across all PanelAI packages.
 * This package is source-only — it's consumed directly by other packages
 * via workspace resolution, not built independently.
 */

// Re-export everything from constants and utils
export * from "./constants/index.js";
export * from "./utils/index.js";

// Types will be exported here as they're created
// export type { AgentCard } from "./types/agent-card.js";
// export type { Task, TaskState } from "./types/task.js";
// export type { InterviewSession, Score } from "./types/interview.js";
