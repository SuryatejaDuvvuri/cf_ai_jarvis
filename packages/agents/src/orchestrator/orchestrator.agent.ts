/**
 * Orchestrator Agent
 *
 * The "conductor" of PanelAI. Manages interview workflow phases,
 * delegates tasks to specialist agents, and ensures human approval
 * at every decision point.
 *
 * Responsibilities:
 * - Decompose interview into phases (screening → technical → culture → domain)
 * - Assign tasks to specialist agents
 * - Collect and synthesize agent assessments
 * - Present recommendations to human for final decision
 * - Track candidate state through the pipeline
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import { generateText } from "ai";
import type {
  AgentRole,
  BiasAuditFlag,
  CombinedScorecard,
  DeliberationComment,
  InterviewerArtifact,
  RecommendationLevel
} from "@panelai/shared";
import { parseJsonObjectFromText } from "../interview/evaluation.js";
import {
  advanceFromRecruiter,
  buildCombinedScorecard,
  finalizeHumanDecision,
  persistPanelOutput,
  startInterview,
  type AdvanceFromRecruiterPayload,
  type FinalizeHumanDecisionPayload,
  type StartInterviewPayload
} from "./orchestrator.tools.js";

interface PanelTranscriptTurn {
  role: "candidate" | "panel";
  speaker?: string;
  text: string;
}

interface RunPanelInterviewPayload {
  interviewId: string;
  candidateId: string;
  transcript?: PanelTranscriptTurn[];
}

const RECOMMENDATION_ORDER: RecommendationLevel[] = [
  "strong-advance",
  "advance",
  "discuss",
  "reject"
];

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function normalizeRecommendation(
  value: unknown,
  fallback: RecommendationLevel
): RecommendationLevel {
  const normalized =
    typeof value === "string" ? value.trim().toLowerCase() : "";
  if (
    normalized === "strong-advance" ||
    normalized === "advance" ||
    normalized === "discuss" ||
    normalized === "reject"
  ) {
    return normalized;
  }
  return fallback;
}

function recommendationDistance(
  a: RecommendationLevel,
  b: RecommendationLevel
): number {
  return Math.abs(
    RECOMMENDATION_ORDER.indexOf(a) - RECOMMENDATION_ORDER.indexOf(b)
  );
}

function getWorstRecommendation(
  artifacts: InterviewerArtifact[]
): RecommendationLevel {
  if (artifacts.length === 0) {
    return "discuss";
  }

  return artifacts
    .map((artifact) => artifact.recommendation)
    .reduce((worst, current) =>
      RECOMMENDATION_ORDER.indexOf(current) >
      RECOMMENDATION_ORDER.indexOf(worst)
        ? current
        : worst
    );
}

export class OrchestratorAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "orchestrator";
  }

  private createApprovalGate(options: {
    interviewId: string;
    type: string;
    prompt: string;
    payload: Record<string, unknown>;
    defaultChoice?: "approve" | "reject";
  }): string {
    const task = this.createLocalTask({
      type: options.type,
      payload: options.payload,
      contextId: options.interviewId,
      priority: "high"
    });
    this.startTask(task.id);
    this.requestApproval(task.id, options.prompt, {
      choices: ["approve", "reject"],
      defaultChoice: options.defaultChoice ?? "approve",
      timeoutMs: 900000 // 15 minutes
    });
    return task.id;
  }

  private buildDeliberationFallback(artifacts: InterviewerArtifact[]): {
    deliberationComments: DeliberationComment[];
    synthesizedRecommendation: RecommendationLevel;
    synthesisRationale: string;
  } {
    const synthesizedRecommendation = getWorstRecommendation(artifacts);

    const deliberationComments: DeliberationComment[] = artifacts
      .map((artifact, index) => {
        const about = artifacts[(index + 1) % artifacts.length];
        if (!about || about.agentId === artifact.agentId) {
          return null;
        }

        const distance = recommendationDistance(
          artifact.recommendation,
          about.recommendation
        );
        const agreement: DeliberationComment["agreement"] =
          distance === 0
            ? "agree"
            : distance === 1
              ? "partially-agree"
              : "disagree";

        const firstStrength =
          about.strengths[0]?.point ?? "assessment strengths";
        const firstConcern = about.concerns[0]?.point ?? "open concerns";
        const comment =
          agreement === "agree"
            ? `I agree with ${about.agentId}'s assessment; their evidence around ${firstStrength.toLowerCase()} aligns with my observations.`
            : agreement === "partially-agree"
              ? `I partially agree with ${about.agentId}; ${firstStrength.toLowerCase()} is valid, but we should still probe ${firstConcern.toLowerCase()}.`
              : `I disagree with ${about.agentId}'s confidence level because ${firstConcern.toLowerCase()} carries higher hiring risk.`;

        return {
          fromAgentId: artifact.agentId,
          aboutAgentId: about.agentId,
          agreement,
          comment,
          timestamp: new Date().toISOString()
        } satisfies DeliberationComment;
      })
      .filter((item): item is DeliberationComment => Boolean(item))
      .slice(0, 6);

    return {
      deliberationComments,
      synthesizedRecommendation,
      synthesisRationale:
        "Deliberation synthesis generated from cross-agent agreement analysis over specialist artifacts."
    };
  }

  private async synthesizeDeliberation(params: {
    interviewId: string;
    candidateId: string;
    artifacts: InterviewerArtifact[];
  }): Promise<{
    deliberationComments: DeliberationComment[];
    synthesizedRecommendation: RecommendationLevel;
    synthesisRationale: string;
  }> {
    const fallback = this.buildDeliberationFallback(params.artifacts);
    if (params.artifacts.length < 2) {
      return fallback;
    }

    const artifactDigest = params.artifacts
      .map((artifact) => {
        const criteria = Object.entries(artifact.scores)
          .map(([key, value]) => `${key}: ${value.score}/5`)
          .join(", ");
        const strengths = artifact.strengths
          .slice(0, 2)
          .map((item) => item.point)
          .join("; ");
        const concerns = artifact.concerns
          .slice(0, 2)
          .map((item) => item.point)
          .join("; ");

        return [
          `Agent: ${artifact.agentId}`,
          `Recommendation: ${artifact.recommendation}`,
          `Criteria: ${criteria || "n/a"}`,
          `Strengths: ${strengths || "n/a"}`,
          `Concerns: ${concerns || "n/a"}`,
          `Rationale: ${artifact.recommendationRationale}`
        ].join("\n");
      })
      .join("\n\n---\n\n");

    try {
      const result = await generateText({
        model: this.resolveModel(),
        maxOutputTokens: 900,
        system: `You are the PanelAI orchestrator generating post-interview deliberation output.

Return ONLY valid JSON:
{
  "synthesizedRecommendation": "strong-advance|advance|discuss|reject",
  "synthesisRationale": "...",
  "deliberationComments": [
    {
      "fromAgentId": "...",
      "aboutAgentId": "...",
      "agreement": "agree|partially-agree|disagree",
      "comment": "..."
    }
  ]
}

Rules:
- Produce 3 to 6 deliberation comments.
- Each comment must compare evidence, not generic praise.
- Ensure fromAgentId and aboutAgentId are valid agent IDs from the provided artifact list.
- Favor conservative synthesis when concerns conflict.`,
        prompt: `Interview ID: ${params.interviewId}
Candidate ID: ${params.candidateId}

Specialist artifacts:
${artifactDigest}`
      });

      const parsed = parseJsonObjectFromText(result.text);
      if (!parsed) {
        return fallback;
      }

      const validAgentIds = new Set(
        params.artifacts.map((artifact) => artifact.agentId)
      );
      const rawComments = Array.isArray(parsed.deliberationComments)
        ? parsed.deliberationComments
        : [];

      const deliberationComments = rawComments
        .map((rawComment) => {
          const record = asRecord(rawComment);
          const fromAgentId =
            typeof record?.fromAgentId === "string"
              ? record.fromAgentId.trim()
              : "";
          const aboutAgentId =
            typeof record?.aboutAgentId === "string"
              ? record.aboutAgentId.trim()
              : "";
          const agreementRaw =
            typeof record?.agreement === "string"
              ? record.agreement.trim().toLowerCase()
              : "";
          const comment =
            typeof record?.comment === "string" ? record.comment.trim() : "";

          if (
            !fromAgentId ||
            !aboutAgentId ||
            fromAgentId === aboutAgentId ||
            !validAgentIds.has(fromAgentId) ||
            !validAgentIds.has(aboutAgentId) ||
            !comment
          ) {
            return null;
          }

          const agreement: DeliberationComment["agreement"] =
            agreementRaw === "agree" ||
            agreementRaw === "partially-agree" ||
            agreementRaw === "disagree"
              ? agreementRaw
              : "partially-agree";

          return {
            fromAgentId,
            aboutAgentId,
            agreement,
            comment,
            timestamp: new Date().toISOString()
          } satisfies DeliberationComment;
        })
        .filter((item): item is DeliberationComment => Boolean(item))
        .slice(0, 6);

      if (deliberationComments.length === 0) {
        return fallback;
      }

      const synthesizedRecommendation = normalizeRecommendation(
        parsed.synthesizedRecommendation,
        fallback.synthesizedRecommendation
      );
      const synthesisRationale =
        typeof parsed.synthesisRationale === "string" &&
        parsed.synthesisRationale.trim().length > 0
          ? parsed.synthesisRationale.trim()
          : fallback.synthesisRationale;

      return {
        deliberationComments,
        synthesizedRecommendation,
        synthesisRationale
      };
    } catch (error) {
      console.error("Deliberation synthesis failed:", error);
      return fallback;
    }
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "start-interview") {
      return startInterview(
        message.payload as StartInterviewPayload,
        this.sharedMemory
      );
    }

    if (message.type === "advance-from-recruiter") {
      const payload = message.payload as AdvanceFromRecruiterPayload;
      const transitionResult = await advanceFromRecruiter(
        payload,
        this.sharedMemory
      );
      const band = payload.recruiterArtifact.recommendationBand;

      if (band === "recommended" || band === "not-recommended") {
        const actionLabel =
          band === "recommended"
            ? "advance this candidate to technical interview"
            : "stop pipeline and reject this candidate";
        const taskId = this.createApprovalGate({
          interviewId: payload.interviewId,
          type: "approval-recruiter-transition",
          payload: {
            interviewId: payload.interviewId,
            candidateId: payload.recruiterArtifact.candidateId,
            recommendationBand: band,
            proposedNextPhase: transitionResult.nextPhase
          },
          prompt: `Recruiter recommendation is "${band}". Approve to ${actionLabel}?`,
          defaultChoice: band === "recommended" ? "approve" : "reject"
        });

        await this.logActivity(
          payload.interviewId,
          "delegation-started",
          "Human approval requested for recruiter transition recommendation.",
          {
            taskId,
            recommendationBand: band,
            proposedNextPhase: transitionResult.nextPhase
          }
        );

        return {
          ...transitionResult,
          nextPhase: "awaiting-approval",
          proposedNextPhase: transitionResult.nextPhase,
          approvalRequired: true,
          approvalTaskId: taskId
        };
      }

      return transitionResult;
    }

    if (message.type === "run-panel-interview") {
      const payload = message.payload as RunPanelInterviewPayload;
      const context = await this.getInterviewContext(payload.interviewId);
      const specialistPayload = {
        interviewId: payload.interviewId,
        candidateId: payload.candidateId,
        transcript: payload.transcript,
        candidateProfile: context.candidateProfile,
        jobRequisition: context.jobRequisition
      };

      await this.logActivity(
        payload.interviewId,
        "delegation-started",
        "Alex Monroe is convening the panel for deliberation…",
        { candidateId: payload.candidateId }
      );

      const technicalResult = await this.delegate<
        typeof specialistPayload,
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("technical", {
        type: "conduct-technical-interview",
        payload: specialistPayload
      });

      const cultureResult = await this.delegate<
        typeof specialistPayload,
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("culture", {
        type: "conduct-culture-interview",
        payload: specialistPayload
      });

      const domainResult = await this.delegate<
        typeof specialistPayload,
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("domain-expert", {
        type: "conduct-domain-interview",
        payload: specialistPayload
      });

      const behavioralResult = await this.delegate<
        typeof specialistPayload,
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("behavioral", {
        type: "conduct-behavioral-interview",
        payload: specialistPayload
      });

      const artifacts = [
        technicalResult.result?.artifact,
        cultureResult.result?.artifact,
        domainResult.result?.artifact,
        behavioralResult.result?.artifact
      ].filter((artifact): artifact is InterviewerArtifact =>
        Boolean(artifact)
      );

      const missingArtifacts: string[] = [];
      if (!technicalResult.result?.artifact) {
        missingArtifacts.push("technical");
      }
      if (!cultureResult.result?.artifact) {
        missingArtifacts.push("culture");
      }
      if (!domainResult.result?.artifact) {
        missingArtifacts.push("domain-expert");
      }
      if (!behavioralResult.result?.artifact) {
        missingArtifacts.push("behavioral");
      }

      if (missingArtifacts.length > 0) {
        return {
          handled: false,
          error: `Missing specialist artifacts: ${missingArtifacts.join(", ")}`,
          delegationStatus: {
            technical: technicalResult.success,
            culture: cultureResult.success,
            domain: domainResult.success,
            behavioral: behavioralResult.success
          }
        };
      }

      await this.logActivity(
        payload.interviewId,
        "deliberation-started",
        "Panel is comparing notes and drafting a joint recommendation…",
        { participantCount: artifacts.length }
      );

      const deliberation = await this.synthesizeDeliberation({
        interviewId: payload.interviewId,
        candidateId: payload.candidateId,
        artifacts
      });

      const scorecard = buildCombinedScorecard({
        interviewId: payload.interviewId,
        candidateId: payload.candidateId,
        artifacts,
        deliberationComments: deliberation.deliberationComments,
        synthesizedRecommendation: deliberation.synthesizedRecommendation,
        synthesisRationale: deliberation.synthesisRationale
      });

      await persistPanelOutput(
        payload.interviewId,
        artifacts,
        scorecard,
        this.sharedMemory
      );

      // ── Bias Audit (silent observer, best-effort) ────────────────────────
      await this.logActivity(
        payload.interviewId,
        "deliberation-started",
        "Orchestrator delegating panel artifacts to Bias Auditor for fairness review."
      );

      const biasResult = await this.delegate<
        {
          interviewId: string;
          artifacts: InterviewerArtifact[];
          scorecard: CombinedScorecard;
        },
        { flags?: BiasAuditFlag[] }
      >("bias-audit", {
        type: "review-panel",
        payload: { interviewId: payload.interviewId, artifacts, scorecard }
      });

      if (
        biasResult.success &&
        biasResult.result?.flags?.length &&
        this.sharedMemory
      ) {
        const scope = `interview:${payload.interviewId}`;
        const updatedScorecard: CombinedScorecard = {
          ...scorecard,
          biasFlags: biasResult.result.flags,
          updatedAt: new Date().toISOString()
        };
        await this.sharedMemory.setScoped(
          scope,
          "combinedScorecard",
          updatedScorecard
        );
      }

      const biasNote = biasResult.result?.flags?.length
        ? ` Bias Auditor flagged ${biasResult.result.flags.length} issue(s).`
        : " No bias flags raised.";

      await this.logActivity(
        payload.interviewId,
        "deliberation-completed",
        `Panel recommends: ${scorecard.synthesizedRecommendation}. Awaiting human decision.${biasNote}`,
        {
          synthesizedRecommendation: scorecard.synthesizedRecommendation,
          artifactCount: artifacts.length
        }
      );

      const panelApprovalTaskId = this.createApprovalGate({
        interviewId: payload.interviewId,
        type: "approval-panel-recommendation",
        payload: {
          interviewId: payload.interviewId,
          candidateId: payload.candidateId,
          synthesizedRecommendation: scorecard.synthesizedRecommendation
        },
        prompt: `Panel recommendation is "${scorecard.synthesizedRecommendation}". Approve this recommendation for final decision review?`,
        defaultChoice:
          scorecard.synthesizedRecommendation === "reject"
            ? "reject"
            : "approve"
      });

      return {
        handled: true,
        phase: "deliberation",
        scorecardStatus: scorecard.status,
        synthesizedRecommendation: scorecard.synthesizedRecommendation,
        requiresHumanDecisionAtEnd: true,
        approvalRequired: true,
        approvalTaskId: panelApprovalTaskId
      };
    }

    if (message.type === "finalize-human-decision") {
      return finalizeHumanDecision(
        message.payload as FinalizeHumanDecisionPayload,
        this.sharedMemory
      );
    }

    return super.onDelegation(message);
  }
}
