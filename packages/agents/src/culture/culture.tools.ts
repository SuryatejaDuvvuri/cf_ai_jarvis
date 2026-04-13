import type { InterviewerArtifact, RecommendationLevel } from "@panelai/shared";

export interface ConductCultureInterviewPayload {
  interviewId?: string;
  candidateId?: string;
}

export function conductCultureInterview(
  agentId: string,
  payload: ConductCultureInterviewPayload
) {
  const recommendation: RecommendationLevel = "advance";
  const artifact: InterviewerArtifact = {
    agentId,
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
