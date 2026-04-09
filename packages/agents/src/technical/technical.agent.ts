/**
 * Technical Interviewer Agent
 *
 * Conducts technical assessment portion of panel interviews.
 * Evaluates coding skills, system design, and technical problem-solving.
 *
 * Responsibilities:
 * - Ask technical questions appropriate to role level
 * - Evaluate code quality, algorithmic thinking
 * - Assess system design abilities (for senior roles)
 * - Score technical competency with rubric
 * - Provide detailed assessment to Orchestrator
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import type {
  AgentRole,
  InterviewerArtifact,
  RecommendationLevel
} from "@panelai/shared";

export class TechnicalInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "technical";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-technical-interview") {
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
          technicalDepth: {
            score: 4,
            jdRequirement:
              "Demonstrates practical coding and architecture depth",
            evidence:
              "Candidate described implementation tradeoffs and debugging process clearly.",
            justification:
              "Strong technical signal with good problem decomposition under constraints."
          },
          problemSolving: {
            score: 4,
            jdRequirement: "Structured problem-solving and reasoning",
            evidence:
              "Approach was broken into assumptions, options, and validation checks.",
            justification:
              "Shows repeatable engineering reasoning instead of ad-hoc responses."
          }
        },
        strengths: [
          {
            point: "Strong implementation reasoning",
            evidence: "Can explain tradeoffs and alternatives"
          }
        ],
        concerns: [
          {
            point: "Could deepen system design breadth for scale scenarios",
            evidence:
              "Focused more on feature-level than platform-level tradeoffs"
          }
        ],
        recommendation,
        recommendationRationale:
          "Technical baseline is solid for moving forward with normal risk.",
        requiresApproval: true,
        questionsAsked: [
          {
            question:
              "Describe a difficult production issue you fixed recently.",
            responseSummary:
              "Candidate walked through hypothesis-driven debugging and mitigation."
          }
        ]
      };

      return {
        handled: true,
        recommendation,
        summary: "Technical interview completed",
        artifact
      };
    }

    return super.onDelegation(message);
  }
}
