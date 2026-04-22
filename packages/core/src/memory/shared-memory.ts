/**
 * SharedMemory - Cross-agent state storage
 *
 * A separate Durable Object that multiple agents can read/write to.
 * Used for interview context, topics covered, alerts, etc.
 */

import type {
  MemoryEntry,
  MemoryMetadata,
  MemoryQueryOptions,
  SharedMemory as ISharedMemory,
  InterviewSharedContext
} from "@panelai/shared";

/** Activity event — a visible unit of backend agent work */
export type ActivityEventType =
  | "turn-started"
  | "turn-produced"
  | "turn-failed"
  | "delegation-started"
  | "delegation-completed"
  | "delegation-failed"
  | "scoring-started"
  | "score-produced"
  | "deliberation-started"
  | "deliberation-completed"
  | "memory-write"
  | "route-selected"
  | "bias-flag";

export interface ActivityEventInput {
  agentId: string;
  agentRole?: string;
  type: ActivityEventType;
  summary: string;
  metadata?: Record<string, unknown>;
}

export interface ActivityEvent extends ActivityEventInput {
  id: string;
  timestamp: string;
}

const ACTIVITY_LIMIT = 500;

/** SQL storage value type (from Cloudflare types) */
type SqlStorageValue = ArrayBuffer | string | number | null;

/** SQLite row shape for shared memories */
interface SharedMemoryRow {
  scope: string;
  key: string;
  value: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

/**
 * SharedMemory Durable Object
 *
 * Provides scoped key-value storage accessible by multiple agents.
 * Each interview session gets its own scope.
 */
export class SharedMemoryDO {
  private initialized = false;
  private subscribers: Map<string, Set<(entry: MemoryEntry) => void>> =
    new Map();
  private _sql: <T = Record<string, SqlStorageValue>>(
    strings: TemplateStringsArray,
    ...values: SqlStorageValue[]
  ) => T[];

  constructor(
    private readonly state: DurableObjectState,
    _env: unknown
  ) {
    // Wrap the SQLite exec method to provide a template tag interface
    this._sql = <T = Record<string, SqlStorageValue>>(
      strings: TemplateStringsArray,
      ...values: SqlStorageValue[]
    ): T[] => {
      // Build the SQL string from template parts
      let query = strings[0];
      for (let i = 1; i < strings.length; i++) {
        query += `?${strings[i]}`;
      }
      // Execute and collect results
      const cursor = this.state.storage.sql.exec<
        Record<string, SqlStorageValue>
      >(query, ...values);
      const results: T[] = [];
      for (const row of cursor) {
        results.push(row as T);
      }
      return results;
    };
  }

  /** Execute SQL query */
  private sql<T = Record<string, SqlStorageValue>>(
    strings: TemplateStringsArray,
    ...values: SqlStorageValue[]
  ): T[] {
    return this._sql<T>(strings, ...values);
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.sql`
      CREATE TABLE IF NOT EXISTS shared_memories (
        scope TEXT NOT NULL,
        key TEXT NOT NULL,
        value TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        PRIMARY KEY (scope, key)
      )
    `;

    this.sql`
      CREATE INDEX IF NOT EXISTS idx_shared_scope 
      ON shared_memories(scope)
    `;

    this.sql`
      CREATE INDEX IF NOT EXISTS idx_shared_updated 
      ON shared_memories(scope, updated_at)
    `;

    this.initialized = true;
  }

  /**
   * Handle fetch requests from other agents
   */
  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    const path = url.pathname;

    try {
      await this.ensureInitialized();

      // Route requests
      if (request.method === "GET" && path === "/get") {
        const scope = url.searchParams.get("scope") ?? "global";
        const key = url.searchParams.get("key");
        if (!key) {
          return new Response("Missing key parameter", { status: 400 });
        }
        const entry = await this.getScoped(scope, key);
        return Response.json(entry);
      }

      if (request.method === "POST" && path === "/set") {
        const body = (await request.json()) as {
          scope: string;
          key: string;
          value: unknown;
          options?: Partial<MemoryMetadata>;
        };
        await this.setScoped(body.scope, body.key, body.value, body.options);
        return Response.json({ success: true });
      }

      if (request.method === "DELETE" && path === "/delete") {
        const scope = url.searchParams.get("scope") ?? "global";
        const key = url.searchParams.get("key");
        if (!key) {
          return new Response("Missing key parameter", { status: 400 });
        }
        const deleted = await this.deleteScoped(scope, key);
        return Response.json({ deleted });
      }

      if (request.method === "GET" && path === "/list") {
        const scope = url.searchParams.get("scope") ?? "global";
        const limit = parseInt(url.searchParams.get("limit") ?? "100", 10);
        const entries = await this.listScoped(scope, { limit });
        return Response.json(entries);
      }

      if (request.method === "DELETE" && path === "/clear-scope") {
        const scope = url.searchParams.get("scope");
        if (!scope) {
          return new Response("Missing scope parameter", { status: 400 });
        }
        await this.clearScope(scope);
        return Response.json({ success: true });
      }

      // Interview context shortcuts
      if (request.method === "GET" && path === "/interview-context") {
        const interviewId = url.searchParams.get("interviewId");
        if (!interviewId) {
          return new Response("Missing interviewId parameter", { status: 400 });
        }
        const context = await this.getInterviewContext(interviewId);
        return Response.json(context);
      }

      if (request.method === "POST" && path === "/add-topic-covered") {
        const body = (await request.json()) as {
          interviewId: string;
          topic: string;
        };
        await this.addTopicCovered(body.interviewId, body.topic);
        return Response.json({ success: true });
      }

      if (request.method === "POST" && path === "/add-question-asked") {
        const body = (await request.json()) as {
          interviewId: string;
          question: string;
          agentId?: string;
        };
        await this.addQuestionAsked(body.interviewId, body.question);
        return Response.json({ success: true });
      }

      if (request.method === "POST" && path === "/add-activity") {
        const body = (await request.json()) as {
          interviewId: string;
          event: ActivityEventInput;
        };
        const saved = await this.addActivity(body.interviewId, body.event);
        return Response.json({ success: true, event: saved });
      }

      if (request.method === "GET" && path === "/activity") {
        const interviewId = url.searchParams.get("interviewId");
        if (!interviewId) {
          return new Response("Missing interviewId parameter", { status: 400 });
        }
        const since = url.searchParams.get("since") ?? undefined;
        const limit = parseInt(url.searchParams.get("limit") ?? "200", 10);
        const events = await this.listActivity(interviewId, { since, limit });
        return Response.json(events);
      }

      if (request.method === "POST" && path === "/add-key-point") {
        const body = (await request.json()) as {
          interviewId: string;
          point: string;
          agentId: string;
        };
        await this.addKeyPoint(body.interviewId, body.agentId, body.point);
        return Response.json({ success: true });
      }

      return new Response("Not Found", { status: 404 });
    } catch (error) {
      console.error("SharedMemory error:", error);
      return new Response(JSON.stringify({ error: String(error) }), {
        status: 500,
        headers: { "Content-Type": "application/json" }
      });
    }
  }

  // ISharedMemory implementation

  async get<T = unknown>(key: string): Promise<MemoryEntry<T> | null> {
    return this.getScoped("global", key);
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: Partial<MemoryMetadata>
  ): Promise<void> {
    return this.setScoped("global", key, value, options);
  }

  async delete(key: string): Promise<boolean> {
    return this.deleteScoped("global", key);
  }

  async has(key: string): Promise<boolean> {
    const entry = await this.get(key);
    return entry !== null;
  }

  async list<T = unknown>(
    options?: MemoryQueryOptions
  ): Promise<MemoryEntry<T>[]> {
    return this.listScoped("global", options);
  }

  async clear(): Promise<void> {
    return this.clearScope("global");
  }

  async getScoped<T = unknown>(
    scope: string,
    key: string
  ): Promise<MemoryEntry<T> | null> {
    await this.ensureInitialized();

    const rows = this.sql<SharedMemoryRow>`
      SELECT * FROM shared_memories 
      WHERE scope = ${scope} AND key = ${key}
    `;

    if (rows.length === 0) return null;

    const row = rows[0];

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.deleteScoped(scope, key);
      return null;
    }

    return {
      key: row.key,
      value: JSON.parse(row.value) as T,
      metadata: JSON.parse(row.metadata) as MemoryMetadata
    };
  }

  async setScoped<T = unknown>(
    scope: string,
    key: string,
    value: T,
    options?: Partial<MemoryMetadata>
  ): Promise<void> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const metadata: MemoryMetadata = {
      createdAt: options?.createdAt ?? now,
      updatedAt: now,
      expiresAt: options?.expiresAt,
      tags: options?.tags ?? [],
      source: options?.source ?? "agent"
    };

    const valueJson = JSON.stringify(value);
    const metadataJson = JSON.stringify(metadata);
    const expiresAt = metadata.expiresAt ?? null;

    this.sql`
      INSERT INTO shared_memories (scope, key, value, metadata, created_at, updated_at, expires_at)
      VALUES (${scope}, ${key}, ${valueJson}, ${metadataJson}, ${metadata.createdAt}, ${metadata.updatedAt}, ${expiresAt})
      ON CONFLICT(scope, key) DO UPDATE SET
        value = ${valueJson},
        metadata = ${metadataJson},
        updated_at = ${metadata.updatedAt},
        expires_at = ${expiresAt}
    `;

    // Notify subscribers
    const entry: MemoryEntry<T> = { key, value, metadata };
    this.notifySubscribers(scope, entry);
  }

  async deleteScoped(scope: string, key: string): Promise<boolean> {
    await this.ensureInitialized();

    const before = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM shared_memories 
      WHERE scope = ${scope} AND key = ${key}
    `;

    this.sql`
      DELETE FROM shared_memories 
      WHERE scope = ${scope} AND key = ${key}
    `;

    return before[0]?.count > 0;
  }

  async listScoped<T = unknown>(
    scope: string,
    options?: MemoryQueryOptions
  ): Promise<MemoryEntry<T>[]> {
    await this.ensureInitialized();

    const rows = this.sql<SharedMemoryRow>`
      SELECT * FROM shared_memories 
      WHERE scope = ${scope}
      ORDER BY updated_at DESC
      LIMIT ${options?.limit ?? 100}
      OFFSET ${options?.offset ?? 0}
    `;

    const now = new Date();
    return rows
      .filter((row) => {
        if (row.expires_at && new Date(row.expires_at) < now) {
          return false;
        }
        return true;
      })
      .map((row) => ({
        key: row.key,
        value: JSON.parse(row.value) as T,
        metadata: JSON.parse(row.metadata) as MemoryMetadata
      }));
  }

  async clearScope(scope: string): Promise<void> {
    await this.ensureInitialized();
    this.sql`DELETE FROM shared_memories WHERE scope = ${scope}`;
  }

  subscribe(scope: string, callback: (entry: MemoryEntry) => void): () => void {
    if (!this.subscribers.has(scope)) {
      this.subscribers.set(scope, new Set());
    }
    this.subscribers.get(scope)!.add(callback);

    return () => {
      this.subscribers.get(scope)?.delete(callback);
    };
  }

  private notifySubscribers(scope: string, entry: MemoryEntry): void {
    const callbacks = this.subscribers.get(scope);
    if (callbacks) {
      for (const callback of callbacks) {
        try {
          callback(entry);
        } catch (error) {
          console.error("Subscriber callback error:", error);
        }
      }
    }
  }

  // Interview-specific helpers

  async getInterviewContext(
    interviewId: string
  ): Promise<InterviewSharedContext | null> {
    const entry = await this.getScoped<InterviewSharedContext>(
      `interview:${interviewId}`,
      "context"
    );
    return entry?.value ?? null;
  }

  async setInterviewContext(
    interviewId: string,
    context: InterviewSharedContext
  ): Promise<void> {
    await this.setScoped(`interview:${interviewId}`, "context", context);
  }

  async addTopicCovered(interviewId: string, topic: string): Promise<void> {
    const context = await this.getInterviewContext(interviewId);
    if (context) {
      if (!context.topicsCovered.includes(topic)) {
        context.topicsCovered.push(topic);
        await this.setInterviewContext(interviewId, context);
      }
    }
  }

  async addQuestionAsked(interviewId: string, question: string): Promise<void> {
    const context = await this.getInterviewContext(interviewId);
    if (context) {
      if (!context.questionsAsked.includes(question)) {
        context.questionsAsked.push(question);
        await this.setInterviewContext(interviewId, context);
      }
    }
  }

  async addKeyPoint(
    interviewId: string,
    agentId: string,
    point: string
  ): Promise<void> {
    const context = await this.getInterviewContext(interviewId);
    if (context) {
      context.keyPoints.push({
        agentId,
        point,
        timestamp: new Date().toISOString()
      });
      await this.setInterviewContext(interviewId, context);
    }
  }

  async addActivity(
    interviewId: string,
    event: ActivityEventInput
  ): Promise<ActivityEvent> {
    const scope = `interview:${interviewId}`;
    const existing = await this.getScoped<ActivityEvent[]>(scope, "activity");
    const list = existing?.value ?? [];
    const saved: ActivityEvent = {
      ...event,
      id: `act-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`,
      timestamp: new Date().toISOString()
    };
    list.push(saved);
    // Cap the list to keep the scoped row bounded
    const trimmed =
      list.length > ACTIVITY_LIMIT ? list.slice(-ACTIVITY_LIMIT) : list;
    await this.setScoped(scope, "activity", trimmed);
    return saved;
  }

  async listActivity(
    interviewId: string,
    options?: { since?: string; limit?: number }
  ): Promise<ActivityEvent[]> {
    const scope = `interview:${interviewId}`;
    const existing = await this.getScoped<ActivityEvent[]>(scope, "activity");
    const list = existing?.value ?? [];
    const filtered = options?.since
      ? list.filter((e) => e.timestamp > options.since!)
      : list;
    const limit = options?.limit ?? 200;
    return filtered.slice(-limit);
  }

  async addAlert(
    interviewId: string,
    agentId: string,
    alert: string,
    severity: "info" | "warning" | "critical"
  ): Promise<void> {
    const context = await this.getInterviewContext(interviewId);
    if (context) {
      context.alerts.push({
        agentId,
        alert,
        severity,
        timestamp: new Date().toISOString()
      });
      await this.setInterviewContext(interviewId, context);
    }
  }
}

/**
 * Client for accessing SharedMemory from other Durable Objects
 */
export class SharedMemoryClient implements ISharedMemory {
  constructor(private stub: DurableObjectStub) {}

  private async request<T>(
    method: string,
    path: string,
    params?: Record<string, string>,
    body?: unknown
  ): Promise<T> {
    const url = new URL(`https://shared-memory${path}`);
    if (params) {
      for (const [key, value] of Object.entries(params)) {
        url.searchParams.set(key, value);
      }
    }

    const response = await this.stub.fetch(url.toString(), {
      method,
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined
    });

    if (!response.ok) {
      throw new Error(`SharedMemory request failed: ${response.statusText}`);
    }

    return response.json() as Promise<T>;
  }

  async get<T = unknown>(key: string): Promise<MemoryEntry<T> | null> {
    return this.request("GET", "/get", { key });
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: Partial<MemoryMetadata>
  ): Promise<void> {
    await this.request("POST", "/set", undefined, {
      scope: "global",
      key,
      value,
      options
    });
  }

  async delete(key: string): Promise<boolean> {
    const result = await this.request<{ deleted: boolean }>(
      "DELETE",
      "/delete",
      { key }
    );
    return result.deleted;
  }

  async has(key: string): Promise<boolean> {
    const entry = await this.get(key);
    return entry !== null;
  }

  async list<T = unknown>(
    options?: MemoryQueryOptions
  ): Promise<MemoryEntry<T>[]> {
    return this.request("GET", "/list", {
      limit: String(options?.limit ?? 100)
    });
  }

  async clear(): Promise<void> {
    await this.request("DELETE", "/clear-scope", { scope: "global" });
  }

  async getScoped<T = unknown>(
    scope: string,
    key: string
  ): Promise<MemoryEntry<T> | null> {
    return this.request("GET", "/get", { scope, key });
  }

  async setScoped<T = unknown>(
    scope: string,
    key: string,
    value: T,
    options?: Partial<MemoryMetadata>
  ): Promise<void> {
    await this.request("POST", "/set", undefined, {
      scope,
      key,
      value,
      options
    });
  }

  async deleteScoped(scope: string, key: string): Promise<boolean> {
    const result = await this.request<{ deleted: boolean }>(
      "DELETE",
      "/delete",
      { scope, key }
    );
    return result.deleted;
  }

  async listScoped<T = unknown>(
    scope: string,
    options?: MemoryQueryOptions
  ): Promise<MemoryEntry<T>[]> {
    return this.request("GET", "/list", {
      scope,
      limit: String(options?.limit ?? 100)
    });
  }

  async clearScope(scope: string): Promise<void> {
    await this.request("DELETE", "/clear-scope", { scope });
  }

  subscribe(
    _scope: string,
    _callback: (entry: MemoryEntry) => void
  ): () => void {
    // Subscription not supported via HTTP client
    // Would need WebSocket for real-time updates
    console.warn("SharedMemoryClient.subscribe() is not supported over HTTP");
    return () => {};
  }

  // Interview-specific shortcuts

  async getInterviewContext(
    interviewId: string
  ): Promise<InterviewSharedContext | null> {
    return this.request("GET", "/interview-context", { interviewId });
  }

  async addTopicCovered(interviewId: string, topic: string): Promise<void> {
    await this.request("POST", "/add-topic-covered", undefined, {
      interviewId,
      topic
    });
  }

  async addQuestionAsked(
    interviewId: string,
    question: string,
    agentId?: string
  ): Promise<void> {
    await this.request("POST", "/add-question-asked", undefined, {
      interviewId,
      question,
      agentId
    });
  }

  async addKeyPoint(
    interviewId: string,
    point: string,
    agentId: string
  ): Promise<void> {
    await this.request("POST", "/add-key-point", undefined, {
      interviewId,
      point,
      agentId
    });
  }

  async addActivity(
    interviewId: string,
    event: ActivityEventInput
  ): Promise<ActivityEvent | null> {
    try {
      const result = await this.request<{ event: ActivityEvent }>(
        "POST",
        "/add-activity",
        undefined,
        { interviewId, event }
      );
      return result.event;
    } catch (error) {
      console.warn("addActivity failed:", error);
      return null;
    }
  }

  async listActivity(
    interviewId: string,
    options?: { since?: string; limit?: number }
  ): Promise<ActivityEvent[]> {
    const params: Record<string, string> = { interviewId };
    if (options?.since) params.since = options.since;
    if (options?.limit) params.limit = String(options.limit);
    return this.request("GET", "/activity", params);
  }
}
