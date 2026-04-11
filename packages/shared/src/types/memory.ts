/**
 * Memory types - Private and Shared memory
 *
 * Agents have private memory (their own state) and can
 * access shared memory (cross-agent context).
 */

/** Memory entry metadata */
export interface MemoryMetadata {
  /** When the entry was created */
  createdAt: string;
  /** When the entry was last updated */
  updatedAt: string;
  /** Entry expiration time (optional) */
  expiresAt?: string;
  /** Tags for categorization */
  tags?: string[];
  /** Source of the memory (agent, user, system) */
  source: "agent" | "user" | "system";
}

/** Single memory entry */
export interface MemoryEntry<T = unknown> {
  /** Unique key for this memory */
  key: string;
  /** The stored value */
  value: T;
  /** Entry metadata */
  metadata: MemoryMetadata;
}

/** Memory query options */
export interface MemoryQueryOptions {
  /** Filter by tags */
  tags?: string[];
  /** Filter by source */
  source?: MemoryMetadata["source"];
  /** Only entries created after this time */
  createdAfter?: string;
  /** Only entries updated after this time */
  updatedAfter?: string;
  /** Maximum number of results */
  limit?: number;
  /** Offset for pagination */
  offset?: number;
}

/** Private memory interface (per-agent) */
export interface PrivateMemory {
  /** Get a memory entry by key */
  get<T = unknown>(key: string, scope?: string): Promise<MemoryEntry<T> | null>;

  /** Set a memory entry */
  set<T = unknown>(
    key: string,
    value: T,
    options?: Partial<MemoryMetadata> & { scope?: string }
  ): Promise<void>;

  /** Delete a memory entry */
  delete(key: string, scope?: string): Promise<boolean>;

  /** Check if a key exists */
  has(key: string, scope?: string): Promise<boolean>;

  /** List all memory entries matching query */
  list<T = unknown>(
    options?: MemoryQueryOptions & { scope?: string }
  ): Promise<MemoryEntry<T>[]>;

  /** Clear all memory (optionally scoped) */
  clear(scope?: string): Promise<void>;
}

/** Shared memory interface (cross-agent) */
export interface SharedMemory extends PrivateMemory {
  /** Get memory scoped to a specific context (e.g., interview session) */
  getScoped<T = unknown>(
    scope: string,
    key: string
  ): Promise<MemoryEntry<T> | null>;

  /** Set memory scoped to a specific context */
  setScoped<T = unknown>(
    scope: string,
    key: string,
    value: T,
    options?: Partial<MemoryMetadata>
  ): Promise<void>;

  /** Delete scoped memory */
  deleteScoped(scope: string, key: string): Promise<boolean>;

  /** List all entries in a scope */
  listScoped<T = unknown>(
    scope: string,
    options?: MemoryQueryOptions
  ): Promise<MemoryEntry<T>[]>;

  /** Clear all entries in a scope */
  clearScope(scope: string): Promise<void>;

  /** Subscribe to changes in a scope (for real-time sync) */
  subscribe(scope: string, callback: (entry: MemoryEntry) => void): () => void;
}

/** Interview context stored in shared memory */
export interface InterviewSharedContext {
  /** Interview session ID (used as scope) */
  interviewId: string;
  /** Candidate profile summary */
  candidateSummary: string;
  /** Job requirements summary */
  jobRequirements: string;
  /** Topics already covered by previous agents */
  topicsCovered: string[];
  /** Questions already asked (to avoid repetition) */
  questionsAsked: string[];
  /** Key points from previous segments */
  keyPoints: Array<{
    agentId: string;
    point: string;
    timestamp: string;
  }>;
  /** Flags/alerts from agents */
  alerts: Array<{
    agentId: string;
    alert: string;
    severity: "info" | "warning" | "critical";
    timestamp: string;
  }>;
}

/** Memory stats for monitoring */
export interface MemoryStats {
  /** Total number of entries */
  totalEntries: number;
  /** Total size in bytes (approximate) */
  totalSizeBytes: number;
  /** Entries by source */
  bySource: Record<MemoryMetadata["source"], number>;
  /** Last updated timestamp */
  lastUpdated: string;
}
