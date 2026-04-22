import type { InterviewerArtifact, RecommendationLevel } from "@panelai/shared";
import type { SpecialistInterviewPayload } from "../interview/evaluation.js";

export interface ConductBehavioralInterviewPayload extends SpecialistInterviewPayload {}

function clampScore(value: number): 1 | 2 | 3 | 4 | 5 {
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as 1 | 2 | 3 | 4 | 5;
}

function countKeywordHits(text: string, keywords: string[]): number {
  return keywords.reduce((count, keyword) => {
    const pattern = new RegExp(`\\b${keyword}\\b`, "i");
    return pattern.test(text) ? count + 1 : count;
  }, 0);
}

function extractCandidateText(
  payload: ConductBehavioralInterviewPayload
): string {
  const turns = payload.transcript ?? [];
  return turns
    .filter((turn) => turn.role === "candidate")
    .map((turn) => turn.text.trim())
    .filter((text) => text.length > 0)
    .join("\n")
    .toLowerCase();
}

function summarizeCandidateResponse(candidateText: string): string {
  if (!candidateText.trim()) {
    return "Candidate provided limited behavioral evidence in the transcript.";
  }

  const sentence = candidateText
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);

  if (!sentence) {
    return "Candidate responses were brief and lacked concrete behavioral examples.";
  }

  return `${sentence.slice(0, 180)}${sentence.length > 180 ? "..." : ""}`;
}

function recommendationFromAverage(avg: number): RecommendationLevel {
  if (avg >= 4.4) return "strong-advance";
  if (avg >= 3.6) return "advance";
  if (avg >= 2.8) return "discuss";
  return "reject";
}

function extractPanelQuestions(
  payload: ConductBehavioralInterviewPayload,
  fallbackSummary: string
): InterviewerArtifact["questionsAsked"] {
  const panelTurns = (payload.transcript ?? [])
    .filter((turn) => turn.role === "panel")
    .flatMap((turn) =>
      turn.text
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line.includes("?"))
    )
    .slice(-3);

  if (panelTurns.length === 0) {
    return [
      {
        question:
          "Tell me about a time you made a difficult judgment call under pressure and what happened next.",
        responseSummary: fallbackSummary
      }
    ];
  }

  return panelTurns.map((question) => ({
    question,
    responseSummary: fallbackSummary
  }));
}

export function conductBehavioralInterview(
  agentId: string,
  payload: ConductBehavioralInterviewPayload
) {
  const candidateText = extractCandidateText(payload);

  const ownershipSignals = countKeywordHits(candidateText, [
    "owned",
    "ownership",
    "accountable",
    "initiative",
    "decision",
    "tradeoff",
    "impact",
    "result",
    "learned",
    "improve"
  ]);

  const collaborationSignals = countKeywordHits(candidateText, [
    "team",
    "collabor",
    "conflict",
    "feedback",
    "communicat",
    "stakeholder",
    "support",
    "mentor",
    "listen"
  ]);

  const ownershipScore = clampScore(
    2 + ownershipSignals / 3 - (candidateText.length < 170 ? 0.7 : 0)
  );
  const collaborationScore = clampScore(
    2 + collaborationSignals / 3 - (candidateText.length < 170 ? 0.7 : 0)
  );

  const recommendation = recommendationFromAverage(
    (ownershipScore + collaborationScore) / 2
  );
  const candidateSummary = summarizeCandidateResponse(candidateText);

  const strengths: InterviewerArtifact["strengths"] = [];
  const concerns: InterviewerArtifact["concerns"] = [];

  if (ownershipScore >= 4) {
    strengths.push({
      point: "Demonstrates ownership under ambiguity",
      evidence:
        "Candidate described accountable decision-making with clear follow-through."
    });
  } else {
    concerns.push({
      point: "Ownership signal needs stronger evidence",
      evidence:
        "Transcript lacked concrete examples showing end-to-end accountability."
    });
  }

  if (collaborationScore >= 4) {
    strengths.push({
      point: "Collaborates effectively in high-friction situations",
      evidence:
        "Candidate referenced conflict handling, communication, and alignment behaviors."
    });
  } else {
    concerns.push({
      point: "Behavioral collaboration evidence is limited",
      evidence:
        "Candidate responses did not provide enough specific interpersonal examples."
    });
  }

  if (strengths.length === 0) {
    strengths.push({
      point: "Baseline behavioral readiness",
      evidence:
        "Candidate showed some judgment and teamwork signal, though deeper probing is needed."
    });
  }

  if (concerns.length === 0) {
    concerns.push({
      point: "Stress-response evidence can be deepened",
      evidence:
        "Additional scenario-based probing can validate consistency under pressure."
    });
  }

  const artifact: InterviewerArtifact = {
    agentId,
    candidateId: payload.candidateId ?? "unknown-candidate",
    interviewId: payload.interviewId ?? "unknown-interview",
    timestamp: new Date().toISOString(),
    scores: {
      ownership: {
        score: ownershipScore,
        jdRequirement: "Takes ownership and follows through under pressure",
        evidence: `Detected ${ownershipSignals} ownership/judgment signals in candidate responses.`,
        justification:
          "Score reflects accountability language, decision ownership, and outcome awareness."
      },
      collaboration: {
        score: collaborationScore,
        jdRequirement:
          "Works effectively with others through conflict and ambiguity",
        evidence: `Detected ${collaborationSignals} collaboration/conflict signals in candidate responses.`,
        justification:
          "Score reflects communication quality, conflict handling, and team alignment behaviors."
      }
    },
    strengths,
    concerns,
    recommendation,
    recommendationRationale: `Behavioral assessment resulted in ${recommendation} based on transcript-grounded ownership and collaboration evidence.`,
    requiresApproval: true,
    questionsAsked: extractPanelQuestions(payload, candidateSummary)
  };

  return {
    handled: true,
    recommendation,
    summary: "Behavioral interview completed",
    artifact
  };
}
