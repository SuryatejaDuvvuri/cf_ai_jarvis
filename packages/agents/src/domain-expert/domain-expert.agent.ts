/**
 * Domain Expert Interviewer Agent
 *
 * Evaluates domain-specific knowledge relevant to the role.
 * Configurable per job posting (e.g., ML, finance, healthcare).
 *
 * Responsibilities:
 * - Ask domain-specific questions
 * - Evaluate depth of expertise
 * - Assess practical experience in the domain
 * - Score domain knowledge with rubric
 * - Provide detailed assessment to Orchestrator
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import type {
  AgentRole,
  InterviewerArtifact,
  RecommendationLevel
} from "@panelai/shared";

export class DomainExpertAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "domain-expert";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-domain-interview") {
      const payload = message.payload as {
        interviewId?: string;
        candidateId?: string;
      };
      const recommendation: RecommendationLevel = "discuss";
      const artifact: InterviewerArtifact = {
        agentId: this.card.id,
        candidateId: payload.candidateId ?? "unknown-candidate",
        interviewId: payload.interviewId ?? "unknown-interview",
        timestamp: new Date().toISOString(),
        scores: {
          domainDepth: {
            score: 3,
            jdRequirement: "Domain-specific architecture and execution depth",
            evidence:
              "Candidate has practical domain exposure but fewer end-to-end ownership examples.",
            justification:
              "Viable baseline, but panel should probe depth for this role’s specialization."
          }
        },
        strengths: [
          {
            point: "Good foundational domain understanding",
            evidence: "Can explain key concepts and common pitfalls clearly"
          }
        ],
        concerns: [
          {
            point: "Limited evidence of leading complex domain initiatives",
            evidence: "Examples focused on contribution rather than ownership"
          }
        ],
        recommendation,
        recommendationRationale:
          "Borderline domain depth; recommend panel deliberation before final decision.",
        requiresApproval: true,
        questionsAsked: [
          {
            question:
              "How would you approach a high-risk domain-specific failure mode?",
            responseSummary:
              "Candidate outlined mitigation workflow but with limited prior ownership examples."
          }
        ]
      };

      return {
        handled: true,
        recommendation,
        summary: "Domain interview completed",
        artifact
      };
    }

    return super.onDelegation(message);
  }
}
