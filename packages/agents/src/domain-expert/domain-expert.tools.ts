import type { InterviewerArtifact, RecommendationLevel } from "@panelai/shared";

export interface ConductDomainInterviewPayload {
  interviewId?: string;
  candidateId?: string;
}

export function conductDomainInterview(
  agentId: string,
  payload: ConductDomainInterviewPayload
) {
  const recommendation: RecommendationLevel = "discuss";
  const artifact: InterviewerArtifact = {
    agentId,
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
          "Viable baseline, but panel should probe depth for this role's specialization."
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
