/**
 * BiasAuditAgent
 *
 * A silent observer agent that reviews all panel interview artifacts after
 * deliberation is complete. Flags potential bias issues:
 *   1. Score divergence ≥2 levels between specialists
 *   2. Language that could serve as a proxy for protected traits
 *   3. Recommendations that contradict the evidence (strengths vs. concerns)
 *
 * Results are attached to the CombinedScorecard and logged as activity events.
 * This agent never gates the hiring decision — it surfaces information only.
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import type {
  AgentRole,
  BiasAuditFlag,
  BiasAuditFlagType,
  CombinedScorecard,
  InterviewerArtifact,
  RecommendationLevel
} from "@panelai/shared";

interface BiasAuditEnv {
  AI?: Ai;
  AI_PROVIDER?: string;
  AI_API_KEY?: string;
  AI_BASE_URL?: string;
  AI_MODEL?: string;
  [key: string]: unknown;
}

/** Numeric severity for comparison */
const REC_ORDER: RecommendationLevel[] = [
  "strong-advance",
  "advance",
  "discuss",
  "reject"
];

export class BiasAuditAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "bias-audit";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "review-panel") {
      const payload = message.payload as {
        interviewId: string;
        artifacts: InterviewerArtifact[];
        scorecard: CombinedScorecard;
      };

      await this.logActivity(
        payload.interviewId,
        "deliberation-started",
        "Bias Auditor is reviewing panel artifacts for fairness issues."
      );

      const flags: BiasAuditFlag[] = [
        ...this.checkScoreDivergence(payload.artifacts),
        ...this.checkStrengthsContradictions(payload.artifacts)
      ];

      // LLM pass for proxy language and deeper contradiction analysis
      const llmFlags = await this.runLLMReview(payload.artifacts);
      flags.push(...llmFlags);

      // Deduplicate by (agentId, type)
      const seen = new Set<string>();
      const deduplicated = flags.filter((f) => {
        const key = `${f.agentId}::${f.type}`;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      });

      // Log each flag as an activity event
      for (const flag of deduplicated) {
        await this.logActivity(
          payload.interviewId,
          "bias-flag",
          `[${flag.severity.toUpperCase()}] ${flag.type}: ${flag.description}`,
          {
            severity: flag.severity,
            agentId: flag.agentId,
            flagType: flag.type
          }
        );
      }

      const summary =
        deduplicated.length === 0
          ? "Bias Auditor found no significant fairness issues."
          : `Bias Auditor flagged ${deduplicated.length} issue(s). Human review recommended.`;

      await this.logActivity(
        payload.interviewId,
        "deliberation-completed",
        summary,
        { flagCount: deduplicated.length }
      );

      return { handled: true, flags: deduplicated };
    }

    return super.onDelegation(message);
  }

  // ─── Heuristic checks ──────────────────────────────────────────────────────

  /** Flag any specialist pair whose recommendations differ by ≥2 levels */
  private checkScoreDivergence(
    artifacts: InterviewerArtifact[]
  ): BiasAuditFlag[] {
    const flags: BiasAuditFlag[] = [];

    for (let i = 0; i < artifacts.length; i++) {
      for (let j = i + 1; j < artifacts.length; j++) {
        const a = artifacts[i];
        const b = artifacts[j];
        const diff = Math.abs(
          REC_ORDER.indexOf(a.recommendation) -
            REC_ORDER.indexOf(b.recommendation)
        );
        if (diff >= 2) {
          flags.push({
            agentId: a.agentId,
            type: "score-divergence" as BiasAuditFlagType,
            description: `Divergence ≥${diff} levels between ${a.agentId} (${a.recommendation}) and ${b.agentId} (${b.recommendation}). Human discussion warranted.`,
            severity: diff >= 3 ? "high" : "medium"
          });
        }
      }
    }

    return flags;
  }

  /** Flag artifacts where a positive recommendation has more concerns than strengths */
  private checkStrengthsContradictions(
    artifacts: InterviewerArtifact[]
  ): BiasAuditFlag[] {
    const flags: BiasAuditFlag[] = [];

    for (const artifact of artifacts) {
      const positiveRec =
        artifact.recommendation === "strong-advance" ||
        artifact.recommendation === "advance";
      const moreConterns =
        artifact.concerns.length > artifact.strengths.length + 1;

      const negativeRec = artifact.recommendation === "reject";
      const moreStrengths =
        artifact.strengths.length > artifact.concerns.length + 1;

      if (positiveRec && moreConterns) {
        flags.push({
          agentId: artifact.agentId,
          type: "strengths-contradiction" as BiasAuditFlagType,
          description: `${artifact.agentId} recommends "${artifact.recommendation}" but listed ${artifact.concerns.length} concerns vs ${artifact.strengths.length} strengths.`,
          severity: "medium"
        });
      } else if (negativeRec && moreStrengths) {
        flags.push({
          agentId: artifact.agentId,
          type: "strengths-contradiction" as BiasAuditFlagType,
          description: `${artifact.agentId} recommends "reject" but listed ${artifact.strengths.length} strengths vs ${artifact.concerns.length} concerns.`,
          severity: "medium"
        });
      }
    }

    return flags;
  }

  // ─── LLM review ────────────────────────────────────────────────────────────

  private async runLLMReview(
    artifacts: InterviewerArtifact[]
  ): Promise<BiasAuditFlag[]> {
    const env = this.env as BiasAuditEnv;

    // Build a compact summary for the LLM to review
    const artifactSummary = artifacts.map((a) => ({
      agentId: a.agentId,
      recommendation: a.recommendation,
      strengths: a.strengths.map((s) => s.point),
      concerns: a.concerns.map((c) => c.point),
      rationale: a.recommendationRationale.slice(0, 400)
    }));

    const prompt = `You are a hiring bias auditor. Review these interview artifacts for fairness:

${JSON.stringify(artifactSummary, null, 2)}

Check ONLY for:
1. "proxy-language": Any language that could be a proxy for protected traits (gender, age, race, national origin, disability) — e.g. "energetic", "recent graduate", "native speaker", "culture fit" used negatively.
2. "strengths-contradiction": Any case where strengths/concerns text directly contradicts the recommendation.

Return a JSON array (no markdown) with zero or more items:
[{"agentId":"...","type":"proxy-language"|"strengths-contradiction","description":"...","severity":"low"|"medium"|"high"}]

Return [] if no issues. Be conservative — only flag clear issues, not speculation.`;

    try {
      if (
        env.AI_PROVIDER === "openai-compatible" &&
        env.AI_API_KEY &&
        env.AI_BASE_URL
      ) {
        const model = env.AI_MODEL ?? "gpt-4o-mini";
        const resp = await fetch(`${env.AI_BASE_URL}/chat/completions`, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Authorization: `Bearer ${env.AI_API_KEY}`
          },
          body: JSON.stringify({
            model,
            messages: [{ role: "user", content: prompt }],
            temperature: 0.1,
            max_tokens: 600
          })
        });
        const json = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        const raw = json.choices?.[0]?.message?.content?.trim() ?? "[]";
        return this.parseLLMFlags(raw);
      }

      if (env.AI) {
        const result = (await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          { messages: [{ role: "user", content: prompt }], temperature: 0.1 }
        )) as { response?: string };
        const raw = result.response?.trim() ?? "[]";
        return this.parseLLMFlags(raw);
      }
    } catch (err) {
      console.error("[BiasAuditAgent] LLM review failed:", err);
    }

    return [];
  }

  private parseLLMFlags(raw: string): BiasAuditFlag[] {
    try {
      // Extract first JSON array from response
      const match = raw.match(/\[[\s\S]*?\]/);
      if (!match) return [];
      const parsed = JSON.parse(match[0]) as BiasAuditFlag[];
      return Array.isArray(parsed) ? parsed : [];
    } catch {
      return [];
    }
  }
}
