/**
 * Agent Delegation
 *
 * Wrapper around getAgentByName() for A2A-style task delegation.
 * Handles message formatting and response parsing.
 */

import type {
  Task,
  AgentRef,
  CreateTaskRequest,
  AgentRole
} from "@panelai/shared";
import { getAgentCard, getAgentCardByRole } from "./agent-card.js";
import {
  createTask,
  startTask,
  completeTask,
  failTask
} from "./task-manager.js";

/** Delegation request payload */
export interface DelegationRequest<TPayload = unknown> {
  /** Task type */
  type: string;
  /** Task payload */
  payload: TPayload;
  /** Context ID for grouping related tasks */
  contextId?: string;
  /** Priority level */
  priority?: "low" | "normal" | "high" | "urgent";
  /** Timeout in milliseconds */
  timeoutMs?: number;
}

/** Delegation result */
export interface DelegationResult<TResult = unknown> {
  /** Whether delegation succeeded */
  success: boolean;
  /** The task that was created */
  task: Task;
  /** Result data if completed synchronously */
  result?: TResult;
  /** Error message if failed */
  error?: string;
}

/** Environment with agent bindings */
type EnvWithAgents = Cloudflare.Env;

/**
 * Get a Durable Object stub for an agent
 *
 * This wraps the pattern:
 * const id = env.AGENT_BINDING.idFromName(agentId);
 * const stub = env.AGENT_BINDING.get(id);
 */
export function getAgentStub(
  env: EnvWithAgents,
  bindingName: string,
  agentId: string
): DurableObjectStub {
  const binding = (env as unknown as Record<string, unknown>)[
    bindingName
  ] as DurableObjectNamespace;
  if (!binding) {
    throw new Error(`Agent binding not found: ${bindingName}`);
  }

  const id = binding.idFromName(agentId);
  return binding.get(id);
}

/**
 * Delegate a task to another agent
 *
 * Usage:
 * ```ts
 * const result = await delegateToAgent({
 *   env: this.env,
 *   from: { id: "orchestrator-1", name: "Orchestrator", role: "orchestrator" },
 *   toRole: "technical",
 *   request: {
 *     type: "conduct-interview",
 *     payload: { candidateId, jobId, questions },
 *   },
 * });
 * ```
 */
export async function delegateToAgent<
  TPayload = unknown,
  TResult = unknown
>(options: {
  env: EnvWithAgents;
  from: AgentRef;
  toRole: AgentRole;
  toId?: string;
  request: DelegationRequest<TPayload>;
}): Promise<DelegationResult<TResult>> {
  const { env, from, toRole, request } = options;

  // Find the target agent
  const targetCard = options.toId
    ? getAgentCard(options.toId)
    : getAgentCardByRole(toRole);

  if (!targetCard) {
    return {
      success: false,
      task: null as unknown as Task,
      error: `No agent found for role: ${toRole}`
    };
  }

  const toRef: AgentRef = {
    id: targetCard.id,
    name: targetCard.name,
    role: targetCard.role
  };

  // Create the task
  const taskRequest: CreateTaskRequest<TPayload> = {
    type: request.type,
    assignedTo: toRef,
    payload: request.payload,
    priority: request.priority,
    contextId: request.contextId
  };

  const task = createTask(taskRequest, from);

  try {
    // Get the DO binding name based on role
    const bindingName = getBindingNameForRole(toRole);
    const stub = getAgentStub(env, bindingName, targetCard.id);

    // Start the task
    startTask(task.id);

    // Send the delegation request
    const response = await stub.fetch("https://agent/delegate", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        taskId: task.id,
        type: request.type,
        payload: request.payload,
        from,
        contextId: request.contextId
      })
    });

    if (!response.ok) {
      const errorText = await response.text();
      failTask(task.id, `Delegation failed: ${errorText}`);
      return {
        success: false,
        task,
        error: errorText
      };
    }

    const result = (await response.json()) as {
      data?: TResult;
      error?: string;
    };

    if (result.error) {
      failTask(task.id, result.error);
      return {
        success: false,
        task,
        error: result.error
      };
    }

    completeTask(task.id, result.data);

    return {
      success: true,
      task,
      result: result.data
    };
  } catch (error) {
    const errorMessage = error instanceof Error ? error.message : String(error);
    failTask(task.id, errorMessage);
    return {
      success: false,
      task,
      error: errorMessage
    };
  }
}

/**
 * Map agent role to Wrangler binding name
 *
 * These must match the bindings in wrangler.jsonc
 */
function getBindingNameForRole(role: AgentRole): string {
  const bindingMap: Record<AgentRole, string> = {
    orchestrator: "ORCHESTRATOR",
    recruiter: "RECRUITER",
    technical: "TECHNICAL_INTERVIEWER",
    culture: "CULTURE_INTERVIEWER",
    "domain-expert": "DOMAIN_EXPERT",
    behavioral: "BEHAVIORAL_INTERVIEWER",
    "bias-audit": "BIAS_AUDIT",
    jarvis: "Chat" // Existing Jarvis binding
  };

  const binding = bindingMap[role];
  if (!binding) {
    throw new Error(`No binding configured for role: ${role}`);
  }

  return binding;
}

/**
 * Send a message to an agent without creating a formal task
 *
 * Useful for notifications, status updates, etc.
 */
export async function notifyAgent(
  env: EnvWithAgents,
  toRole: AgentRole,
  toId: string,
  message: {
    type: string;
    payload: unknown;
    from: AgentRef;
  }
): Promise<boolean> {
  try {
    const bindingName = getBindingNameForRole(toRole);
    const stub = getAgentStub(env, bindingName, toId);

    const response = await stub.fetch("https://agent/notify", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify(message)
    });

    return response.ok;
  } catch (error) {
    console.error(`Failed to notify agent ${toId}:`, error);
    return false;
  }
}

/**
 * Broadcast a message to all agents of a specific role
 */
export async function broadcastToRole(
  _env: EnvWithAgents,
  toRole: AgentRole,
  _message: {
    type: string;
    payload: unknown;
    from: AgentRef;
  }
): Promise<{ sent: number; failed: number }> {
  // This would need a registry of all active agent instances
  // For now, just log a warning
  console.warn(
    `broadcastToRole not fully implemented. Would broadcast to all ${toRole} agents.`
  );
  return { sent: 0, failed: 0 };
}
