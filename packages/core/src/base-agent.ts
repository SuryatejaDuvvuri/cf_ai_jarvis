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
import { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import { generateText } from "ai";
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
  getTasksAwaitingInput,
  getTask,
  provideInput
} from "./a2a/task-manager.js";
import { delegateToAgent, type DelegationResult } from "./a2a/delegation.js";
import { PrivateMemoryImpl } from "./memory/private-memory.js";
import {
  SharedMemoryClient,
  type ActivityEventType
} from "./memory/shared-memory.js";

/** Environment with required bindings */
export interface CoreAgentEnv extends Cloudflare.Env {
  AI: Ai;
  AI_PROVIDER?: "workers-ai" | "openai-compatible" | "groq";
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
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

interface ReflectionReview {
  needsRevision: boolean;
  revisedDraft?: string;
  rationale?: string;
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
   * Resolve the AI model using Workers AI binding
   */
  protected resolveModel() {
    const env = this.env as Record<string, unknown>;
    const rawProvider = (
      (env.AI_PROVIDER as string) ?? "workers-ai"
    ).toLowerCase();
    const isWorkersAI = rawProvider === "workers-ai";

    const modelName =
      (env.AI_MODEL as string) ??
      (isWorkersAI
        ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
        : "llama-3.3-70b-versatile");

    if (isWorkersAI) {
      const workersAI = createWorkersAI({ binding: env.AI as Ai });
      return workersAI(modelName as Parameters<typeof workersAI>[0]);
    }

    const apiKey = ((env.AI_API_KEY as string) ?? "").trim();
    const configuredBaseUrl = ((env.AI_BASE_URL as string) ?? "").trim();
    const baseURL =
      configuredBaseUrl ||
      (rawProvider === "groq" ? "https://api.groq.com/openai/v1" : "");

    if (!apiKey) {
      throw new Error(
        "AI_API_KEY is required when AI_PROVIDER is not workers-ai."
      );
    }

    if (!baseURL) {
      throw new Error(
        "AI_BASE_URL is required when AI_PROVIDER is openai-compatible."
      );
    }

    const openai = createOpenAI({ apiKey, baseURL });
    return openai.chat(modelName);
  }

  private parseReflectionReview(rawText: string): ReflectionReview | null {
    const fencedMatch = rawText.match(/```(?:json)?\s*([\s\S]*?)```/i);
    const candidateJson = fencedMatch ? fencedMatch[1] : rawText;
    const start = candidateJson.indexOf("{");
    const end = candidateJson.lastIndexOf("}");
    if (start === -1 || end === -1 || end <= start) {
      return null;
    }

    try {
      const parsed = JSON.parse(
        candidateJson.slice(start, end + 1)
      ) as Partial<{
        needsRevision: unknown;
        revisedDraft: unknown;
        rationale: unknown;
      }>;
      if (typeof parsed.needsRevision !== "boolean") {
        return null;
      }
      return {
        needsRevision: parsed.needsRevision,
        revisedDraft:
          typeof parsed.revisedDraft === "string"
            ? parsed.revisedDraft
            : undefined,
        rationale:
          typeof parsed.rationale === "string" ? parsed.rationale : undefined
      };
    } catch (_error) {
      return null;
    }
  }

  /**
   * Reflection loop for quality-improving draft outputs.
   * Runs at most maxIterations (default 2) and returns the best draft text.
   */
  protected async reflect(options: {
    draft: string;
    taskContext: string;
    outputContract: string;
    maxIterations?: number;
  }): Promise<string> {
    const maxIterations = Math.max(1, options.maxIterations ?? 2);
    let currentDraft = options.draft;

    for (let iteration = 0; iteration < maxIterations; iteration += 1) {
      try {
        const review = await generateText({
          model: this.resolveModel(),
          temperature: 0,
          maxOutputTokens: 350,
          maxRetries: 0,
          system: `You are an internal quality reviewer for interview artifacts.
Return ONLY valid JSON:
{
  "needsRevision": boolean,
  "revisedDraft": "string (required if needsRevision=true)",
  "rationale": "short explanation"
}
Rules:
- Keep the same output format contract exactly.
- If draft already satisfies the contract and evidence quality, set needsRevision=false.
- If revising, return a complete revised draft in revisedDraft (not a diff).`,
          prompt: `Task context:
${options.taskContext}

Output contract:
${options.outputContract}

Current draft:
${currentDraft}`
        });

        const parsed = this.parseReflectionReview(review.text);
        if (!parsed || !parsed.needsRevision || !parsed.revisedDraft?.trim()) {
          break;
        }

        currentDraft = parsed.revisedDraft.trim();
      } catch (error) {
        console.warn("Reflection step failed, returning latest draft:", error);
        break;
      }
    }

    return currentDraft;
  }

  /**
   * Return this agent's interview system prompt.
   * Subclasses override this to give each specialist their own persona.
   */
  protected getInterviewSystemPrompt(_candidateContext?: string): string {
    return "You are a professional interviewer conducting a job interview. Ask relevant questions and be helpful.";
  }

  /**
   * Handle a /turn request — generate one interviewer response for the live chat.
   * Returns JSON { text: string }.
   */
  private async handleInterviewTurn(request: Request): Promise<Response> {
    try {
      const body = (await request.json()) as {
        messages: Array<{ role: "user" | "assistant"; content: string }>;
        candidateContext?: string;
        interviewId?: string;
      };
      const model = this.resolveModel();
      const systemPrompt = this.getInterviewSystemPrompt(body.candidateContext);

      await this.logActivity(
        body.interviewId,
        "turn-started",
        `${this.card.name} is thinking of a reply…`,
        { turnCount: body.messages?.length ?? 0 }
      );

      // Some OpenAI-compatible providers are strict about message content shapes.
      // Build a plain transcript prompt for broad compatibility.
      const transcript = (body.messages ?? [])
        .map((message) => {
          const speaker = message.role === "user" ? "Candidate" : "Panel";
          return `${speaker}: ${message.content}`;
        })
        .join("\n\n")
        .trim();

      const prompt = transcript.length
        ? `${transcript}\n\nContinue the interview naturally and respond as the interviewer for this turn.`
        : "Begin this interview turn with one concise, role-appropriate interviewer question.";

      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 25_000);
      try {
        const result = await generateText({
          model,
          system: systemPrompt,
          prompt,
          abortSignal: controller.signal,
          maxOutputTokens: 400
        });
        await this.logActivity(
          body.interviewId,
          "turn-produced",
          `${this.card.name}: "${result.text.slice(0, 140)}${result.text.length > 140 ? "…" : ""}"`,
          { length: result.text.length }
        );
        return Response.json({ text: result.text });
      } finally {
        clearTimeout(timeoutId);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      return Response.json({ error: message }, { status: 500 });
    }
  }

  /**
   * Override fetch to handle A2A-style requests
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);

    // Handle interview turn (live chat delegation)
    if (url.pathname === "/turn" && request.method === "POST") {
      return this.handleInterviewTurn(request);
    }

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

    // Resolve a human approval/input gate for a pending task.
    const taskResolveMatch = url.pathname.match(/^\/tasks\/([^/]+)\/resolve$/);
    if (taskResolveMatch && request.method === "POST") {
      const taskId = decodeURIComponent(taskResolveMatch[1]);
      const task = getTask(taskId);
      if (!task) {
        return Response.json({ error: "Task not found" }, { status: 404 });
      }
      if (task.state !== "input-required") {
        return Response.json(
          { error: `Task is not awaiting input (state: ${task.state})` },
          { status: 400 }
        );
      }

      const body = (await request.json().catch(() => ({}))) as {
        approved?: boolean;
        choice?: string;
        notes?: string;
      };

      const decision = Boolean(body.approved);
      const resolvedChoice =
        body.choice?.trim() || (decision ? "approve" : "reject");

      provideInput(taskId, {
        approved: decision,
        choice: resolvedChoice,
        notes: body.notes
      });
      completeTask(taskId, {
        approved: decision,
        choice: resolvedChoice,
        notes: body.notes
      });

      const updated = getTask(taskId);
      return Response.json({
        success: true,
        task: updated
      });
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
   * Log a user-visible activity event to shared memory so the Agent Office
   * panel can render what this agent is doing in real time.
   * Silently no-ops if shared memory or interviewId is missing.
   */
  protected async logActivity(
    interviewId: string | undefined,
    type: ActivityEventType,
    summary: string,
    metadata?: Record<string, unknown>
  ): Promise<void> {
    if (!interviewId || !this.sharedMemory) return;
    try {
      await this.sharedMemory.addActivity(interviewId, {
        agentId: this.card.id,
        agentRole: this.role,
        type,
        summary,
        metadata
      });
    } catch (error) {
      console.warn(`logActivity failed (${type}):`, error);
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
