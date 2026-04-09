/**
 * PrivateMemory - Per-agent SQLite-backed memory
 *
 * Each agent instance has its own private memory that persists
 * across conversations. Extracted from Jarvis's memory pattern.
 */

import type {
  MemoryEntry,
  MemoryMetadata,
  MemoryQueryOptions,
  PrivateMemory as IPrivateMemory
} from "@panelai/shared";

/** SQLite row shape for memories table */
interface MemoryRow {
  key: string;
  scope: string;
  value: string;
  metadata: string; // JSON-serialized MemoryMetadata
  created_at: string;
  updated_at: string;
  expires_at: string | null;
}

/**
 * Private memory implementation using Durable Object's SQLite
 *
 * Usage:
 * ```ts
 * class MyAgent extends CoreAgent {
 *   private memory = new PrivateMemoryImpl(() => this.sql);
 *
 *   async someMethod() {
 *     await this.memory.set("user-name", "John", { tags: ["user-info"] });
 *     const entry = await this.memory.get("user-name");
 *
 *     // With scoping
 *     await this.memory.set("score", 85, { scope: "interview:123" });
 *     const score = await this.memory.get("score", "interview:123");
 *   }
 * }
 * ```
 */

/** Generic SQL function type that works with both AIChatAgent.sql and DurableObjectState.storage.sql */
// biome-ignore lint/suspicious/noExplicitAny: Need flexibility for different SQL implementations
type SqlFunction = (...args: any[]) => any[];

export class PrivateMemoryImpl implements IPrivateMemory {
  private initialized = false;
  private static readonly DEFAULT_SCOPE = "default";

  constructor(private sqlGetter: () => SqlFunction) {}

  private sql<T>(strings: TemplateStringsArray, ...values: unknown[]): T[] {
    return this.sqlGetter()(strings, ...values) as T[];
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;

    this.sql`
      CREATE TABLE IF NOT EXISTS agent_memories (
        key TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'default',
        value TEXT NOT NULL,
        metadata TEXT NOT NULL,
        created_at TEXT DEFAULT CURRENT_TIMESTAMP,
        updated_at TEXT DEFAULT CURRENT_TIMESTAMP,
        expires_at TEXT,
        PRIMARY KEY (key, scope)
      )
    `;

    // Create index for common queries
    this.sql`
      CREATE INDEX IF NOT EXISTS idx_memories_scope_updated 
      ON agent_memories(scope, updated_at)
    `;

    this.initialized = true;
  }

  async get<T = unknown>(
    key: string,
    scope?: string
  ): Promise<MemoryEntry<T> | null> {
    await this.ensureInitialized();
    const scopeValue = scope ?? PrivateMemoryImpl.DEFAULT_SCOPE;

    const rows = this.sql<MemoryRow>`
      SELECT * FROM agent_memories WHERE key = ${key} AND scope = ${scopeValue}
    `;

    if (rows.length === 0) return null;

    const row = rows[0];

    // Check expiration
    if (row.expires_at && new Date(row.expires_at) < new Date()) {
      await this.delete(key, scope);
      return null;
    }

    return {
      key: row.key,
      value: JSON.parse(row.value) as T,
      metadata: JSON.parse(row.metadata) as MemoryMetadata
    };
  }

  async set<T = unknown>(
    key: string,
    value: T,
    options?: Partial<MemoryMetadata> & { scope?: string }
  ): Promise<void> {
    await this.ensureInitialized();

    const now = new Date().toISOString();
    const scopeValue = options?.scope ?? PrivateMemoryImpl.DEFAULT_SCOPE;
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
      INSERT INTO agent_memories (key, scope, value, metadata, created_at, updated_at, expires_at)
      VALUES (${key}, ${scopeValue}, ${valueJson}, ${metadataJson}, ${metadata.createdAt}, ${metadata.updatedAt}, ${expiresAt})
      ON CONFLICT(key, scope) DO UPDATE SET
        value = ${valueJson},
        metadata = ${metadataJson},
        updated_at = ${metadata.updatedAt},
        expires_at = ${expiresAt}
    `;
  }

  async delete(key: string, scope?: string): Promise<boolean> {
    await this.ensureInitialized();
    const scopeValue = scope ?? PrivateMemoryImpl.DEFAULT_SCOPE;

    const before = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM agent_memories WHERE key = ${key} AND scope = ${scopeValue}
    `;

    this
      .sql`DELETE FROM agent_memories WHERE key = ${key} AND scope = ${scopeValue}`;

    return before[0]?.count > 0;
  }

  async has(key: string, scope?: string): Promise<boolean> {
    await this.ensureInitialized();
    const scopeValue = scope ?? PrivateMemoryImpl.DEFAULT_SCOPE;

    const rows = this.sql<{ count: number }>`
      SELECT COUNT(*) as count FROM agent_memories WHERE key = ${key} AND scope = ${scopeValue}
    `;

    return rows[0]?.count > 0;
  }

  async list<T = unknown>(
    options?: MemoryQueryOptions & { scope?: string }
  ): Promise<MemoryEntry<T>[]> {
    await this.ensureInitialized();
    const scopeValue = options?.scope ?? PrivateMemoryImpl.DEFAULT_SCOPE;

    // Build query with filters
    // Note: Using raw SQL template since we need dynamic WHERE clauses
    let rows: MemoryRow[];

    if (options?.tags && options.tags.length > 0) {
      // Filter by tags (check if any tag matches)
      const tagPattern = options.tags.map((t) => `%"${t}"%`).join("");
      rows = this.sql<MemoryRow>`
        SELECT * FROM agent_memories 
        WHERE scope = ${scopeValue} AND metadata LIKE ${tagPattern}
        ORDER BY updated_at DESC
        LIMIT ${options?.limit ?? 100}
        OFFSET ${options?.offset ?? 0}
      `;
    } else {
      rows = this.sql<MemoryRow>`
        SELECT * FROM agent_memories 
        WHERE scope = ${scopeValue}
        ORDER BY updated_at DESC
        LIMIT ${options?.limit ?? 100}
        OFFSET ${options?.offset ?? 0}
      `;
    }

    const now = new Date();
    return rows
      .filter((row) => {
        // Filter out expired entries
        if (row.expires_at && new Date(row.expires_at) < now) {
          return false;
        }
        // Apply source filter
        if (options?.source) {
          const metadata = JSON.parse(row.metadata) as MemoryMetadata;
          if (metadata.source !== options.source) {
            return false;
          }
        }
        return true;
      })
      .map((row) => ({
        key: row.key,
        value: JSON.parse(row.value) as T,
        metadata: JSON.parse(row.metadata) as MemoryMetadata
      }));
  }

  async clear(scope?: string): Promise<void> {
    await this.ensureInitialized();

    if (scope) {
      this.sql`DELETE FROM agent_memories WHERE scope = ${scope}`;
    } else {
      this.sql`DELETE FROM agent_memories`;
    }
  }
}

/**
 * Legacy memory adapter for backward compatibility with Jarvis
 *
 * Provides the old simple key-value interface on top of the new system.
 */
export class LegacyMemoryAdapter {
  constructor(private memory: PrivateMemoryImpl) {}

  async saveMemory(key: string, value: string): Promise<void> {
    await this.memory.set(key, value, { source: "user" });
  }

  async getMemories(): Promise<
    Array<{ key: string; value: string; createdAt: string }>
  > {
    const entries = await this.memory.list<string>();
    return entries.map((e) => ({
      key: e.key,
      value: e.value,
      createdAt: e.metadata.createdAt
    }));
  }

  async deleteMemories(key: string): Promise<void> {
    await this.memory.delete(key);
  }
}
