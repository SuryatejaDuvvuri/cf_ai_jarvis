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
import type {
  AgentRole,
  CombinedScorecard,
  InterviewerArtifact,
  RecommendationLevel,
  RecruiterArtifact
} from "@panelai/shared";

export class OrchestratorAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "orchestrator";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "start-interview") {
      const payload = message.payload as {
        interviewId?: string;
        candidateProfile?: unknown;
        jobRequisition?: unknown;
      };

      if (payload.interviewId && this.sharedMemory) {
        const scope = `interview:${payload.interviewId}`;
        if (payload.candidateProfile) {
          await this.sharedMemory.setScoped(
            scope,
            "candidateProfile",
            payload.candidateProfile
          );
        }
        if (payload.jobRequisition) {
          await this.sharedMemory.setScoped(
            scope,
            "jobRequisition",
            payload.jobRequisition
          );
        }
      }

      return {
        handled: true,
        phase: "screening",
        message: "Interview orchestration initialized"
      };
    }

    if (message.type === "advance-from-recruiter") {
      const payload = message.payload as {
        interviewId: string;
        recruiterArtifact: RecruiterArtifact;
      };
      const artifact = payload.recruiterArtifact;

      const nextPhase =
        artifact.recommendationBand === "recommended"
          ? "technical"
          : artifact.recommendationBand === "maybe"
            ? "screening"
            : "completed";

      if (this.sharedMemory) {
        const scope = `interview:${payload.interviewId}`;
        await this.sharedMemory.setScoped(scope, "recruiterArtifact", artifact);
        await this.sharedMemory.setScoped(scope, "candidateCoachingSummary", {
          candidateId: artifact.candidateId,
          summary: artifact.candidateCoachingSummary
        });
      }

      return {
        handled: true,
        nextPhase,
        requiresHumanDecisionAtEnd: true,
        internalOnlyScorecard: true
      };
    }

    if (message.type === "run-panel-interview") {
      const payload = message.payload as {
        interviewId: string;
        candidateId: string;
      };
      const scope = `interview:${payload.interviewId}`;

      const technicalResult = await this.delegate<
        { interviewId: string; candidateId: string },
        {
          artifact?: InterviewerArtifact;
          recommendation?: RecommendationLevel;
          handled?: boolean;
        }
      >("technical", {
        type: "conduct-technical-interview",
        payload
      });

      const cultureResult = await this.delegate<
        { interviewId: string; candidateId: string },
        {
          artifact?: InterviewerArtifact;
          recommendation?: RecommendationLevel;
          handled?: boolean;
        }
      >("culture", {
        type: "conduct-culture-interview",
        payload
      });

      const domainResult = await this.delegate<
        { interviewId: string; candidateId: string },
        {
          artifact?: InterviewerArtifact;
          recommendation?: RecommendationLevel;
          handled?: boolean;
        }
      >("domain-expert", {
        type: "conduct-domain-interview",
        payload
      });

      const artifacts = [
        technicalResult.result?.artifact,
        cultureResult.result?.artifact,
        domainResult.result?.artifact
      ].filter((a): a is InterviewerArtifact => Boolean(a));

      const recommendationOrder: RecommendationLevel[] = [
        "strong-advance",
        "advance",
        "discuss",
        "reject"
      ];
      const recommendationValues = artifacts.map((a) =>
        recommendationOrder.indexOf(a.recommendation)
      );
      const worstRecommendation =
        recommendationValues.length === 0
          ? "discuss"
          : recommendationOrder[Math.max(...recommendationValues)];

      const averageScore = (values: number[], fallback: number = 0): number => {
        if (values.length === 0) return fallback;
        return values.reduce((sum, v) => sum + v, 0) / values.length;
      };

      const overallScores = {
        technical: averageScore(
          artifacts.map((a) => a.scores.technicalDepth?.score ?? 3)
        ),
        collaboration: averageScore(
          artifacts.map((a) => a.scores.collaboration?.score ?? 3)
        ),
        domain: averageScore(
          artifacts.map((a) => a.scores.domainDepth?.score ?? 3)
        )
      };

      const scorecard: CombinedScorecard = {
        interviewId: payload.interviewId,
        candidateId: payload.candidateId,
        agentArtifacts: artifacts,
        deliberationComments: [],
        synthesizedRecommendation: worstRecommendation,
        synthesisRationale:
          "Synthesized from technical, culture, and domain interviewer outputs. Human review required for final decision.",
        overallScores,
        status: "ready-for-decision",
        createdAt: new Date().toISOString(),
        updatedAt: new Date().toISOString()
      };

      if (this.sharedMemory) {
        const [technicalArtifact, cultureArtifact, domainArtifact] = artifacts;
        if (technicalArtifact) {
          await this.sharedMemory.setScoped(
            scope,
            "technicalArtifact",
            technicalArtifact
          );
        }
        if (cultureArtifact) {
          await this.sharedMemory.setScoped(
            scope,
            "cultureArtifact",
            cultureArtifact
          );
        }
        if (domainArtifact) {
          await this.sharedMemory.setScoped(
            scope,
            "domainArtifact",
            domainArtifact
          );
        }
        await this.sharedMemory.setScoped(
          scope,
          "combinedScorecard",
          scorecard
        );
      }

      return {
        handled: true,
        phase: "deliberation",
        scorecardStatus: scorecard.status,
        synthesizedRecommendation: scorecard.synthesizedRecommendation,
        requiresHumanDecisionAtEnd: true
      };
    }

    if (message.type === "finalize-human-decision") {
      const payload = message.payload as {
        interviewId: string;
        decision: "hire" | "reject" | "follow-up";
        decidedBy: string;
        notes?: string;
      };
      const scope = `interview:${payload.interviewId}`;
      if (!this.sharedMemory) {
        return {
          handled: false,
          error: "Shared memory unavailable"
        };
      }

      const scorecardEntry =
        await this.sharedMemory.getScoped<CombinedScorecard>(
          scope,
          "combinedScorecard"
        );
      if (!scorecardEntry) {
        return {
          handled: false,
          error: "No combined scorecard found for interview."
        };
      }

      const updated: CombinedScorecard = {
        ...scorecardEntry.value,
        status: "decided",
        humanDecision: {
          decision: payload.decision,
          decidedBy: payload.decidedBy,
          decidedAt: new Date().toISOString(),
          notes: payload.notes
        },
        updatedAt: new Date().toISOString()
      };

      await this.sharedMemory.setScoped(scope, "combinedScorecard", updated);
      return {
        handled: true,
        phase: "completed",
        decision: updated.humanDecision?.decision
      };
    }

    return super.onDelegation(message);
  }
}
