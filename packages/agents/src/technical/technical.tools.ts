import type { InterviewerArtifact, RecommendationLevel } from "@panelai/shared";
import type { SpecialistInterviewPayload } from "../interview/evaluation.js";

export interface ConductTechnicalInterviewPayload extends SpecialistInterviewPayload {}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

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

function extractProfileSkills(
  payload: ConductTechnicalInterviewPayload
): string[] {
  const profile = asRecord(payload.candidateProfile);
  const skills = profile?.skills;

  if (!Array.isArray(skills)) {
    return [];
  }

  return skills
    .map((value) => (typeof value === "string" ? value.trim() : ""))
    .filter((value) => value.length > 0);
}

function extractYearsExperience(
  payload: ConductTechnicalInterviewPayload
): number {
  const profile = asRecord(payload.candidateProfile);
  const years = profile?.yearsExperience;

  if (typeof years === "number" && Number.isFinite(years)) {
    return years;
  }

  return 0;
}

function extractCandidateText(
  payload: ConductTechnicalInterviewPayload
): string {
  const turns = payload.transcript ?? [];
  return turns
    .filter((turn) => turn.role === "candidate")
    .map((turn) => turn.text.trim())
    .filter((text) => text.length > 0)
    .join("\n")
    .toLowerCase();
}

function extractPanelQuestions(
  payload: ConductTechnicalInterviewPayload,
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
          "Walk me through a recent engineering problem where you had to choose between two imperfect technical options.",
        responseSummary: fallbackSummary
      }
    ];
  }

  return panelTurns.map((question) => ({
    question,
    responseSummary: fallbackSummary
  }));
}

function summarizeCandidateResponse(candidateText: string): string {
  if (!candidateText.trim()) {
    return "Candidate provided limited technical evidence in the supplied transcript.";
  }

  const firstSentence = candidateText
    .split(/[.!?]/)
    .map((sentence) => sentence.trim())
    .find((sentence) => sentence.length > 0);

  if (!firstSentence) {
    return "Candidate shared technical details, but evidence remained brief.";
  }

  return `${firstSentence.slice(0, 180)}${firstSentence.length > 180 ? "..." : ""}`;
}

function recommendationFromAverage(avg: number): RecommendationLevel {
  if (avg >= 4.4) return "strong-advance";
  if (avg >= 3.6) return "advance";
  if (avg >= 2.8) return "discuss";
  return "reject";
}

export function conductTechnicalInterview(
  agentId: string,
  payload: ConductTechnicalInterviewPayload
) {
  const candidateText = extractCandidateText(payload);
  const skills = extractProfileSkills(payload);
  const yearsExperience = extractYearsExperience(payload);

  const technicalSignals = countKeywordHits(candidateText, [
    "architecture",
    "system",
    "latency",
    "throughput",
    "tradeoff",
    "distributed",
    "database",
    "caching",
    "api",
    "debug",
    "observability",
    "reliability"
  ]);

  const problemSolvingSignals = countKeywordHits(candidateText, [
    "assumption",
    "hypothesis",
    "measure",
    "validate",
    "root cause",
    "iterate",
    "first",
    "then",
    "because",
    "impact"
  ]);

  const technicalDepthScore = clampScore(
    2 +
      technicalSignals / 3 +
      Math.min(2, skills.length / 4) +
      (yearsExperience >= 8 ? 1 : yearsExperience >= 4 ? 0.5 : 0) -
      (candidateText.length < 180 ? 0.8 : 0)
  );

  const problemSolvingScore = clampScore(
    2 +
      problemSolvingSignals / 3 +
      (candidateText.includes("tradeoff") ? 0.5 : 0) +
      (candidateText.includes("debug") || candidateText.includes("root cause")
        ? 0.5
        : 0) -
      (candidateText.length < 150 ? 0.5 : 0)
  );

  const recommendation = recommendationFromAverage(
    (technicalDepthScore + problemSolvingScore) / 2
  );

  const candidateSummary = summarizeCandidateResponse(candidateText);
  const strengths: InterviewerArtifact["strengths"] = [];
  const concerns: InterviewerArtifact["concerns"] = [];

  if (technicalDepthScore >= 4) {
    strengths.push({
      point: "Strong technical depth across core engineering topics",
      evidence:
        "Candidate referenced architectural tradeoffs and system-level constraints."
    });
  } else {
    concerns.push({
      point: "Technical depth evidence is inconsistent",
      evidence:
        "Transcript has limited examples covering architecture and production complexity."
    });
  }

  if (problemSolvingScore >= 4) {
    strengths.push({
      point: "Structured debugging and problem-solving approach",
      evidence:
        "Candidate described step-by-step reasoning with validation and iteration."
    });
  } else {
    concerns.push({
      point: "Problem-solving narrative needs clearer structure",
      evidence:
        "Candidate responses lacked explicit assumptions, validation steps, or outcome checks."
    });
  }

  if (strengths.length === 0) {
    strengths.push({
      point: "Baseline technical readiness",
      evidence:
        "Candidate showed enough technical familiarity to continue with targeted follow-ups."
    });
  }

  if (concerns.length === 0) {
    concerns.push({
      point: "Scale-readiness evidence still needs targeted probing",
      evidence:
        "Further deep-dive questions can validate reliability and architecture leadership scope."
    });
  }

  const artifact: InterviewerArtifact = {
    agentId,
    candidateId: payload.candidateId ?? "unknown-candidate",
    interviewId: payload.interviewId ?? "unknown-interview",
    timestamp: new Date().toISOString(),
    scores: {
      technicalDepth: {
        score: technicalDepthScore,
        jdRequirement: "Demonstrates practical coding and architecture depth",
        evidence: `Detected ${technicalSignals} domain-specific technical signals in candidate responses.`,
        justification:
          "Score blends transcript evidence, skill profile signal, and demonstrated technical specificity."
      },
      problemSolving: {
        score: problemSolvingScore,
        jdRequirement: "Structured problem-solving and reasoning",
        evidence: `Detected ${problemSolvingSignals} structured problem-solving signals in candidate answers.`,
        justification:
          "Score reflects hypothesis-driven thinking, validation discipline, and clarity of reasoning."
      }
    },
    strengths,
    concerns,
    recommendation,
    recommendationRationale: `Technical assessment resulted in ${recommendation} based on transcript-grounded scoring across depth and problem-solving.`,
    requiresApproval: true,
    questionsAsked: extractPanelQuestions(payload, candidateSummary)
  };

  return {
    handled: true,
    recommendation,
    summary: "Technical interview completed",
    artifact
  };
}
