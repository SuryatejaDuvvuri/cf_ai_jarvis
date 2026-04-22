/**
 * BiasAuditFlag — emitted by BiasAuditAgent when reviewing panel interview artifacts
 */

/** The type of bias detected */
export type BiasAuditFlagType =
  | "score-divergence" // ≥2-level gap between specialist recommendations
  | "proxy-language" // Language that could be proxy for protected traits
  | "strengths-contradiction"; // Strengths/concerns inconsistent with recommendation

/** A single bias flag emitted by the BiasAuditAgent */
export interface BiasAuditFlag {
  /** The agent whose artifact triggered this flag */
  agentId: string;
  /** Type of bias issue detected */
  type: BiasAuditFlagType;
  /** Human-readable description of the issue */
  description: string;
  /** Severity of the flag */
  severity: "low" | "medium" | "high";
}
