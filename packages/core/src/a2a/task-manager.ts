/**
 * Task Manager
 *
 * Manages task lifecycle following A2A-inspired states.
 * Handles task creation, state transitions, and history tracking.
 */

import type {
  Task,
  TaskState,
  TaskResult,
  TaskMetadata,
  TaskTransition,
  TaskWithHistory,
  CreateTaskRequest,
  InputRequirement,
  AgentRef
} from "@panelai/shared";
import { isValidTransition, isTerminalState } from "@panelai/shared";
import { generateId } from "ai";

/** In-memory task storage (per DO instance) */
const tasks: Map<string, TaskWithHistory> = new Map();

/**
 * Create a new task
 */
export function createTask<TPayload = unknown>(
  request: CreateTaskRequest<TPayload>,
  createdBy: AgentRef
): Task<TPayload> {
  const now = new Date().toISOString();
  const id = generateId();

  const metadata: TaskMetadata = {
    createdAt: now,
    updatedAt: now,
    retryCount: 0,
    maxRetries: request.maxRetries ?? 3
  };

  const task: TaskWithHistory<TPayload> = {
    id,
    type: request.type,
    state: "submitted",
    priority: request.priority ?? "normal",
    createdBy,
    assignedTo: request.assignedTo,
    payload: request.payload,
    metadata,
    parentTaskId: request.parentTaskId,
    contextId: request.contextId,
    transitions: [
      {
        from: "submitted" as TaskState,
        to: "submitted",
        timestamp: now,
        reason: "Task created"
      }
    ]
  };

  tasks.set(id, task);
  return task;
}

/**
 * Get a task by ID
 */
export function getTask<TPayload = unknown, TResult = unknown>(
  id: string
): Task<TPayload, TResult> | undefined {
  return tasks.get(id) as Task<TPayload, TResult> | undefined;
}

/**
 * Get a task with full transition history
 */
export function getTaskWithHistory<TPayload = unknown, TResult = unknown>(
  id: string
): TaskWithHistory<TPayload, TResult> | undefined {
  return tasks.get(id) as TaskWithHistory<TPayload, TResult> | undefined;
}

/**
 * Transition a task to a new state
 */
export function transitionTask(
  id: string,
  to: TaskState,
  reason?: string
): Task | undefined {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  if (isTerminalState(task.state)) {
    throw new Error(
      `Cannot transition task ${id} from terminal state ${task.state}`
    );
  }

  if (!isValidTransition(task.state, to)) {
    throw new Error(`Invalid transition: ${task.state} → ${to} for task ${id}`);
  }

  const now = new Date().toISOString();
  const transition: TaskTransition = {
    from: task.state,
    to,
    timestamp: now,
    reason
  };

  task.state = to;
  task.metadata.updatedAt = now;
  task.transitions.push(transition);

  // Track timing
  if (to === "working" && !task.metadata.startedAt) {
    task.metadata.startedAt = now;
  }
  if (isTerminalState(to)) {
    task.metadata.completedAt = now;
  }

  return task;
}

/**
 * Start working on a task
 */
export function startTask(id: string): Task | undefined {
  return transitionTask(id, "working", "Started processing");
}

/**
 * Request input for a task (human approval, clarification, etc.)
 */
export function requestInput(
  id: string,
  requirement: InputRequirement
): Task | undefined {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  task.inputRequirement = requirement;
  return transitionTask(id, "input-required", requirement.prompt);
}

/**
 * Provide input to a waiting task and resume
 */
export function provideInput(id: string, input: unknown): Task | undefined {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  if (task.state !== "input-required") {
    throw new Error(
      `Task ${id} is not waiting for input (state: ${task.state})`
    );
  }

  // Store the input in the task (could be used by the processing logic)
  const taskWithInput = task as Task & { providedInput?: unknown };
  taskWithInput.providedInput = input;
  task.inputRequirement = undefined;

  return transitionTask(id, "working", "Input received, resuming");
}

/**
 * Complete a task with a result
 */
export function completeTask<TResult = unknown>(
  id: string,
  data?: TResult
): Task | undefined {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  task.result = {
    success: true,
    data
  } as TaskResult<TResult>;

  return transitionTask(id, "completed", "Task completed successfully");
}

/**
 * Fail a task with an error
 */
export function failTask(
  id: string,
  error: string,
  errorCode?: string
): Task | undefined {
  const task = tasks.get(id);
  if (!task) {
    throw new Error(`Task not found: ${id}`);
  }

  task.result = {
    success: false,
    error,
    errorCode
  };

  // Check if we should retry
  if (task.metadata.retryCount < task.metadata.maxRetries) {
    task.metadata.retryCount++;
    return transitionTask(
      id,
      "submitted",
      `Retry ${task.metadata.retryCount}/${task.metadata.maxRetries}: ${error}`
    );
  }

  return transitionTask(id, "failed", error);
}

/**
 * Cancel a task
 */
export function cancelTask(id: string, reason?: string): Task | undefined {
  return transitionTask(id, "canceled", reason ?? "Canceled by user");
}

/**
 * Get all tasks for a context (e.g., interview session)
 */
export function getTasksByContext(contextId: string): Task[] {
  const result: Task[] = [];
  for (const task of tasks.values()) {
    if (task.contextId === contextId) {
      result.push(task);
    }
  }
  return result;
}

/**
 * Get all tasks assigned to an agent
 */
export function getTasksByAssignee(agentId: string): Task[] {
  const result: Task[] = [];
  for (const task of tasks.values()) {
    if (task.assignedTo.id === agentId) {
      result.push(task);
    }
  }
  return result;
}

/**
 * Get all tasks in a specific state
 */
export function getTasksByState(state: TaskState): Task[] {
  const result: Task[] = [];
  for (const task of tasks.values()) {
    if (task.state === state) {
      result.push(task);
    }
  }
  return result;
}

/**
 * Get pending tasks that require input
 */
export function getTasksAwaitingInput(): Task[] {
  return getTasksByState("input-required");
}

/**
 * Clear all tasks (for testing)
 */
export function clearAllTasks(): void {
  tasks.clear();
}

/**
 * Delete a specific task
 */
export function deleteTask(id: string): boolean {
  return tasks.delete(id);
}
