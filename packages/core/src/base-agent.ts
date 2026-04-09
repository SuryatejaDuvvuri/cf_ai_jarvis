/**
 * CoreAgent Base Class
 *
 * Base class for all PanelAI agents. Extends AIChatAgent with:
 * - Agent Card registration
 * - Private and shared memory access
 * - Task delegation support
 * - A2A-style message handling
 */

import { AIChatAgent } from "@cloudflare/ai-chat";
import type {
  AgentCard,
  AgentRole,
  Task,
  CreateTaskRequest,
  AgentRef,
  PrivateMemory
} from "@panelai/shared";
import { createDefaultAgentCard, registerAgentCard } from "./a2a/agent-card.js";
import {
  createTask,
  startTask,
  completeTask,
  failTask,
  requestInput,
  getTasksAwaitingInput
} from "./a2a/task-manager.js";
import { delegateToAgent, type DelegationResult } from "./a2a/delegation.js";
import { PrivateMemoryImpl } from "./memory/private-memory.js";
import { SharedMemoryClient } from "./memory/shared-memory.js";

/** Environment with required bindings */
export interface CoreAgentEnv extends Cloudflare.Env {
  AI: Ai;
  [key: string]: unknown;
}

/** Notification message from another agent */
export interface AgentNotification {
  type: string;
  payload: unknown;
  from: AgentRef;
}

/** Delegation request from another agent */
export interface DelegationMessage<TPayload = unknown> {
  taskId: string;
  type: string;
  payload: TPayload;
  from: AgentRef;
  contextId?: string;
}

/**
 * CoreAgent base class
 *
 * All PanelAI agents extend this class. Provides:
 * - Agent Card for discovery
 * - Private memory (agent-local)
 * - Shared memory client (cross-agent)
 * - Task delegation helpers
 * - A2A-style fetch handler
 */
export abstract class CoreAgent<
  TEnv extends CoreAgentEnv = CoreAgentEnv
> extends AIChatAgent<TEnv> {
  /** The agent's card (set during init) */
  protected _card: AgentCard | null = null;

  /** Private memory instance (lazy-initialized) */
  private _privateMemory: PrivateMemory | null = null;

  /** Shared memory client (lazy-initialized) */
  private _sharedMemoryClient: SharedMemoryClient | null = null;

  /**
   * Define the agent's role. Subclasses must implement this.
   */
  protected abstract get role(): AgentRole;

  /**
   * Get the agent's card
   */
  get card(): AgentCard {
    if (!this._card) {
      const safeAgentId = this.getSafeAgentId();
      this._card = createDefaultAgentCard(this.role, {
        id: safeAgentId
      });
      registerAgentCard(this._card);
    }
    return this._card;
  }

  private getSafeAgentId(): string {
    try {
      const id = (this as { name?: string }).name;
      if (id && id.length > 0) return id;
    } catch (_error) {}
    return `${this.role}-agent`;
  }

  /**
   * Get agent reference (for delegation)
   */
  get ref(): AgentRef {
    return {
      id: this.card.id,
      name: this.card.name,
      role: this.card.role
    };
  }

  /**
   * Get private memory for this agent
   */
  get privateMemory(): PrivateMemory {
    if (!this._privateMemory) {
      this._privateMemory = new PrivateMemoryImpl(() => this.sql);
    }
    return this._privateMemory;
  }

  /**
   * Get shared memory client
   */
  get sharedMemory(): SharedMemoryClient | null {
    const sharedMemoryBinding = (this.env as Record<string, unknown>)
      .SharedMemory as DurableObjectNamespace | undefined;

    if (!this._sharedMemoryClient && sharedMemoryBinding) {
      const id = sharedMemoryBinding.idFromName("global");
      const stub = sharedMemoryBinding.get(id);
      this._sharedMemoryClient = new SharedMemoryClient(stub);
    }
    return this._sharedMemoryClient;
  }

  /**
   * Override fetch to handle A2A-style requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle delegation requests
    if (url.pathname === "/delegate" && request.method === "POST") {
      return this.handleDelegation(request);
    }

    // Handle notifications
    if (url.pathname === "/notify" && request.method === "POST") {
      return this.handleNotification(request);
    }

    // Handle agent card requests
    if (url.pathname === "/card" && request.method === "GET") {
      return Response.json(this.card);
    }

    // Handle pending tasks check
    if (url.pathname === "/tasks/pending" && request.method === "GET") {
      const tasks = getTasksAwaitingInput();
      return Response.json(tasks);
    }

    // Fallback to default AIChatAgent handling
    return super.fetch(request);
  }

  /**
   * Handle a delegation request from another agent
   */
  private async handleDelegation(request: Request): Promise<Response> {
    try {
      const message = (await request.json()) as DelegationMessage;

      // Validate the delegation
      if (!message.taskId || !message.type || !message.from) {
        return Response.json(
          { error: "Invalid delegation request" },
          { status: 400 }
        );
      }

      // Process the delegation
      const result = await this.onDelegation(message);

      return Response.json({ data: result });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const agentLabel = `${this.constructor.name}(${this.role})`;
      console.error(`Delegation error in ${agentLabel}:`, error);
      return Response.json({ error: errorMessage }, { status: 500 });
    }
  }

  /**
   * Handle a notification from another agent
   */
  private async handleNotification(request: Request): Promise<Response> {
    try {
      const notification = (await request.json()) as AgentNotification;

      // Validate the notification
      if (!notification.type || !notification.from) {
        return Response.json(
          { error: "Invalid notification" },
          { status: 400 }
        );
      }

      // Process the notification
      await this.onNotification(notification);

      return Response.json({ success: true });
    } catch (error) {
      const errorMessage =
        error instanceof Error ? error.message : String(error);
      const agentLabel = `${this.constructor.name}(${this.role})`;
      console.error(`Notification error in ${agentLabel}:`, error);
      return Response.json({ error: errorMessage }, { status: 500 });
    }
  }

  /**
   * Called when this agent receives a delegated task.
   * Subclasses should override to handle specific task types.
   */
  protected async onDelegation(message: DelegationMessage): Promise<unknown> {
    console.warn(
      `${this.card.name} received unhandled delegation: ${message.type}`
    );
    return { handled: false, message: "No handler for this task type" };
  }

  /**
   * Called when this agent receives a notification.
   * Subclasses can override to handle specific notification types.
   */
  protected async onNotification(
    notification: AgentNotification
  ): Promise<void> {
    console.log(
      `${this.card.name} received notification: ${notification.type}`
    );
  }

  /**
   * Delegate a task to another agent
   */
  protected async delegate<TPayload = unknown, TResult = unknown>(
    toRole: AgentRole,
    request: {
      type: string;
      payload: TPayload;
      contextId?: string;
      priority?: "low" | "normal" | "high" | "urgent";
    }
  ): Promise<DelegationResult<TResult>> {
    return delegateToAgent<TPayload, TResult>({
      env: this.env,
      from: this.ref,
      toRole,
      request
    });
  }

  /**
   * Create a task for this agent to work on
   */
  protected createLocalTask<TPayload = unknown>(
    request: Omit<CreateTaskRequest<TPayload>, "assignedTo">
  ): Task<TPayload> {
    return createTask(
      {
        ...request,
        assignedTo: this.ref
      },
      this.ref
    );
  }

  /**
   * Start working on a task
   */
  protected startTask(taskId: string): void {
    startTask(taskId);
  }

  /**
   * Complete a task with a result
   */
  protected completeTask<TResult = unknown>(
    taskId: string,
    result?: TResult
  ): void {
    completeTask(taskId, result);
  }

  /**
   * Fail a task with an error
   */
  protected failTask(taskId: string, error: string): void {
    failTask(taskId, error);
  }

  /**
   * Request human input for a task
   */
  protected requestApproval(
    taskId: string,
    prompt: string,
    options?: {
      choices?: string[];
      defaultChoice?: string;
      timeoutMs?: number;
    }
  ): void {
    requestInput(taskId, {
      prompt,
      type: options?.choices ? "select" : "confirm",
      choices: options?.choices,
      defaultValue: options?.defaultChoice,
      timeoutMs: options?.timeoutMs ?? 300000 // 5 min default
    });
  }

  /**
   * Store a value in private memory
   */
  protected async remember(
    key: string,
    value: unknown,
    scope: string = "default"
  ): Promise<void> {
    await this.privateMemory.set(key, value, { scope });
  }

  /**
   * Retrieve a value from private memory
   */
  protected async recall<T = unknown>(
    key: string,
    scope: string = "default"
  ): Promise<T | undefined> {
    const entry = await this.privateMemory.get<T>(key, scope);
    return entry?.value;
  }

  /**
   * Get interview context from shared memory
   */
  protected async getInterviewContext(interviewId: string): Promise<{
    candidateProfile?: unknown;
    jobRequisition?: unknown;
    topicsCovered?: string[];
    questionsAsked?: Array<{ question: string; askedBy: string }>;
    keyPoints?: Array<{ point: string; addedBy: string }>;
  }> {
    if (!this.sharedMemory) {
      return {};
    }

    const scope = `interview:${interviewId}`;
    const [
      candidateProfile,
      jobRequisition,
      topicsCovered,
      questionsAsked,
      keyPoints
    ] = await Promise.all([
      this.sharedMemory.getScoped(scope, "candidateProfile"),
      this.sharedMemory.getScoped(scope, "jobRequisition"),
      this.sharedMemory.getScoped<string[]>(scope, "topicsCovered"),
      this.sharedMemory.getScoped<Array<{ question: string; askedBy: string }>>(
        scope,
        "questionsAsked"
      ),
      this.sharedMemory.getScoped<Array<{ point: string; addedBy: string }>>(
        scope,
        "keyPoints"
      )
    ]);

    return {
      candidateProfile: candidateProfile?.value,
      jobRequisition: jobRequisition?.value,
      topicsCovered: topicsCovered?.value ?? [],
      questionsAsked: questionsAsked?.value ?? [],
      keyPoints: keyPoints?.value ?? []
    };
  }

  /**
   * Add a topic to the covered list (in shared memory)
   */
  protected async markTopicCovered(
    interviewId: string,
    topic: string
  ): Promise<void> {
    if (this.sharedMemory) {
      await this.sharedMemory.addTopicCovered(interviewId, topic);
    }
  }

  /**
   * Record a question that was asked (in shared memory)
   */
  protected async recordQuestion(
    interviewId: string,
    question: string
  ): Promise<void> {
    if (this.sharedMemory) {
      await this.sharedMemory.addQuestionAsked(
        interviewId,
        question,
        this.card.id
      );
    }
  }

  /**
   * Add a key point observation (in shared memory)
   */
  protected async addKeyPoint(
    interviewId: string,
    point: string
  ): Promise<void> {
    if (this.sharedMemory) {
      await this.sharedMemory.addKeyPoint(interviewId, point, this.card.id);
    }
  }
}
