/**
 * Task - A2A-inspired task lifecycle
 *
 * Tasks are the fundamental unit of work between agents.
 * They follow a defined lifecycle: submitted → working → completed/failed
 * With optional input-required state for human-in-the-loop.
 */

import type { AgentRef } from "./agent-card.js";

/** Task lifecycle states (A2A-inspired) */
export type TaskState =
  | "submitted" // Task created, waiting to be picked up
  | "working" // Agent is actively processing
  | "input-required" // Blocked waiting for external input (human approval)
  | "completed" // Successfully finished
  | "failed" // Failed with error
  | "canceled"; // Canceled before completion

/** Task priority levels */
export type TaskPriority = "low" | "normal" | "high" | "urgent";

/** Task metadata */
export interface TaskMetadata {
  /** When the task was created */
  createdAt: string;
  /** When the task was last updated */
  updatedAt: string;
  /** When the task started processing */
  startedAt?: string;
  /** When the task completed */
  completedAt?: string;
  /** Number of retry attempts */
  retryCount: number;
  /** Maximum allowed retries */
  maxRetries: number;
}

/** Input required details */
export interface InputRequirement {
  /** Type of input needed */
  type: "approval" | "confirm" | "select" | "text" | "data" | "clarification";
  /** What is being requested */
  prompt: string;
  /** Options/choices if applicable */
  choices?: string[];
  /** @deprecated Use choices instead */
  options?: string[];
  /** Who should provide input */
  requiredFrom?: "human" | "agent";
  /** Default value if applicable */
  defaultValue?: string;
  /** Timeout for input (ms) */
  timeoutMs?: number;
}

/** Task result on completion */
export interface TaskResult<T = unknown> {
  /** Whether the task succeeded */
  success: boolean;
  /** Result data if successful */
  data?: T;
  /** Error message if failed */
  error?: string;
  /** Error code if failed */
  errorCode?: string;
}

/** Task definition */
export interface Task<TPayload = unknown, TResult = unknown> {
  /** Unique task identifier */
  id: string;
  /** Task type/name */
  type: string;
  /** Current state */
  state: TaskState;
  /** Priority level */
  priority: TaskPriority;
  /** Agent that created the task */
  createdBy: AgentRef;
  /** Agent assigned to execute the task */
  assignedTo: AgentRef;
  /** Task payload/input */
  payload: TPayload;
  /** Task result (populated on completion) */
  result?: TaskResult<TResult>;
  /** Input requirement (when state = input-required) */
  inputRequirement?: InputRequirement;
  /** Task metadata */
  metadata: TaskMetadata;
  /** Parent task ID if this is a subtask */
  parentTaskId?: string;
  /** Context/session ID for grouping related tasks */
  contextId?: string;
}

/** Task creation request */
export interface CreateTaskRequest<TPayload = unknown> {
  type: string;
  assignedTo: AgentRef;
  payload: TPayload;
  priority?: TaskPriority;
  parentTaskId?: string;
  contextId?: string;
  maxRetries?: number;
}

/** Task state transition */
export interface TaskTransition {
  from: TaskState;
  to: TaskState;
  timestamp: string;
  reason?: string;
}

/** Task with full history */
export interface TaskWithHistory<
  TPayload = unknown,
  TResult = unknown
> extends Task<TPayload, TResult> {
  transitions: TaskTransition[];
}
