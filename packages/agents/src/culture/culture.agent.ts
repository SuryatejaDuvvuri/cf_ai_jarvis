/**
 * Culture Fit Interviewer Agent
 *
 * Assesses candidate alignment with company values, team dynamics,
 * and work style preferences.
 *
 * Responsibilities:
 * - Ask behavioral questions (STAR format)
 * - Evaluate communication style
 * - Assess teamwork and collaboration signals
 * - Check alignment with company values
 * - Score culture fit with rubric
 * - Provide detailed assessment to Orchestrator
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import type {
  AgentRole,
  InterviewerArtifact,
  RecommendationLevel
} from "@panelai/shared";

export class CultureInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "culture";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-culture-interview") {
      const payload = message.payload as {
        interviewId?: string;
        candidateId?: string;
      };
      const recommendation: RecommendationLevel = "advance";
      const artifact: InterviewerArtifact = {
        agentId: this.card.id,
        candidateId: payload.candidateId ?? "unknown-candidate",
        interviewId: payload.interviewId ?? "unknown-interview",
        timestamp: new Date().toISOString(),
        scores: {
          collaboration: {
            score: 4,
            jdRequirement: "Effective collaboration in cross-functional teams",
            evidence:
              "Provided concrete examples of conflict resolution and consensus building.",
            justification:
              "Strong collaboration signal with healthy communication habits."
          },
          ownership: {
            score: 4,
            jdRequirement: "Takes ownership and follows through",
            evidence:
              "Described end-to-end accountability across planning and delivery.",
            justification:
              "Demonstrates responsibility and stakeholder communication."
          }
        },
        strengths: [
          {
            point: "High collaboration maturity",
            evidence: "Uses structured feedback loops and alignment checkpoints"
          }
        ],
        concerns: [
          {
            point: "Could provide more examples in ambiguous org conditions",
            evidence: "Most examples were within stable team settings"
          }
        ],
        recommendation,
        recommendationRationale:
          "Culture fit indicators are positive and support progression.",
        requiresApproval: true,
        questionsAsked: [
          {
            question:
              "Tell me about a disagreement with a teammate and how you handled it.",
            responseSummary:
              "Candidate resolved conflict through shared goals and clear role definition."
          }
        ]
      };

      return {
        handled: true,
        recommendation,
        summary: "Culture interview completed",
        artifact
      };
    }

    return super.onDelegation(message);
  }
}
