/**
 * Task state machine definitions
 */

import type { TaskState } from "../types/task.js";

/** Valid task state transitions */
export const TASK_TRANSITIONS: Record<TaskState, readonly TaskState[]> = {
  submitted: ["working", "canceled"],
  // Allow resubmission from active states to support retry flow in task manager.
  working: ["submitted", "input-required", "completed", "failed", "canceled"],
  "input-required": ["submitted", "working", "completed", "failed", "canceled"],
  completed: [], // Terminal state
  failed: [], // Terminal state
  canceled: [] // Terminal state
} as const;

/** Terminal states (no transitions allowed) */
export const TERMINAL_STATES: readonly TaskState[] = [
  "completed",
  "failed",
  "canceled"
] as const;

/** Active states (task is being processed) */
export const ACTIVE_STATES: readonly TaskState[] = [
  "working",
  "input-required"
] as const;

/** Check if a state transition is valid */
export function isValidTransition(from: TaskState, to: TaskState): boolean {
  return TASK_TRANSITIONS[from].includes(to);
}

/** Check if a state is terminal */
export function isTerminalState(state: TaskState): boolean {
  return TERMINAL_STATES.includes(state);
}

/** Check if a state is active */
export function isActiveState(state: TaskState): boolean {
  return ACTIVE_STATES.includes(state);
}

/** Task state display names */
export const TASK_STATE_NAMES: Record<TaskState, string> = {
  submitted: "Submitted",
  working: "In Progress",
  "input-required": "Awaiting Input",
  completed: "Completed",
  failed: "Failed",
  canceled: "Canceled"
} as const;

/** Task state icons (for UI) */
export const TASK_STATE_ICONS: Record<TaskState, string> = {
  submitted: "📥",
  working: "⚙️",
  "input-required": "⏳",
  completed: "✅",
  failed: "❌",
  canceled: "🚫"
} as const;
