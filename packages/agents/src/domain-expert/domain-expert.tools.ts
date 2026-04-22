import type { InterviewerArtifact, RecommendationLevel } from "@panelai/shared";
import type { SpecialistInterviewPayload } from "../interview/evaluation.js";

export interface ConductDomainInterviewPayload extends SpecialistInterviewPayload {}

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

function extractCandidateText(payload: ConductDomainInterviewPayload): string {
  const turns = payload.transcript ?? [];
  return turns
    .filter((turn) => turn.role === "candidate")
    .map((turn) => turn.text.trim())
    .filter((text) => text.length > 0)
    .join("\n")
    .toLowerCase();
}

function extractRequiredSkills(
  payload: ConductDomainInterviewPayload
): string[] {
  const job = asRecord(payload.jobRequisition);
  const skillsRaw = job?.requiredSkills;
  if (!Array.isArray(skillsRaw)) {
    return [];
  }

  return skillsRaw
    .map((value) =>
      typeof value === "string" ? value.trim().toLowerCase() : ""
    )
    .filter((value) => value.length > 0)
    .slice(0, 10);
}

function summarizeCandidateResponse(candidateText: string): string {
  if (!candidateText.trim()) {
    return "Candidate supplied limited domain-specific evidence in the transcript.";
  }

  const sentence = candidateText
    .split(/[.!?]/)
    .map((part) => part.trim())
    .find((part) => part.length > 0);

  if (!sentence) {
    return "Candidate responses were brief and lacked domain-specific examples.";
  }

  return `${sentence.slice(0, 180)}${sentence.length > 180 ? "..." : ""}`;
}

function recommendationFromScore(score: number): RecommendationLevel {
  if (score >= 4.5) return "strong-advance";
  if (score >= 3.6) return "advance";
  if (score >= 2.8) return "discuss";
  return "reject";
}

function extractPanelQuestions(
  payload: ConductDomainInterviewPayload,
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
          "Describe a high-risk domain-specific failure mode you have managed and how you mitigated it.",
        responseSummary: fallbackSummary
      }
    ];
  }

  return panelTurns.map((question) => ({
    question,
    responseSummary: fallbackSummary
  }));
}

export function conductDomainInterview(
  agentId: string,
  payload: ConductDomainInterviewPayload
) {
  const candidateText = extractCandidateText(payload);
  const requiredSkills = extractRequiredSkills(payload);

  const domainSignals = countKeywordHits(candidateText, [
    "compliance",
    "regulation",
    "risk",
    "incident",
    "domain",
    "policy",
    "governance",
    "customer",
    "operations",
    "audit",
    "failure",
    "mitigation"
  ]);

  const matchedRequiredSkills = requiredSkills.filter((skill) =>
    candidateText.includes(skill)
  ).length;
  const requiredSkillCoverage =
    requiredSkills.length === 0
      ? 0
      : matchedRequiredSkills / requiredSkills.length;

  const domainDepthScore = clampScore(
    2 +
      domainSignals / 4 +
      requiredSkillCoverage * 2 -
      (candidateText.length < 170 ? 0.6 : 0)
  );

  const recommendation = recommendationFromScore(domainDepthScore);
  const candidateSummary = summarizeCandidateResponse(candidateText);

  const strengths: InterviewerArtifact["strengths"] = [];
  const concerns: InterviewerArtifact["concerns"] = [];

  if (domainDepthScore >= 4) {
    strengths.push({
      point: "Strong practical domain judgment",
      evidence:
        "Candidate referenced domain risk handling and context-aware decision making."
    });
  } else {
    concerns.push({
      point: "Domain depth needs deeper validation",
      evidence:
        "Transcript had limited evidence of owning domain-critical decisions end-to-end."
    });
  }

  if (requiredSkills.length > 0 && requiredSkillCoverage >= 0.6) {
    strengths.push({
      point: "Good alignment to JD domain expectations",
      evidence: `Matched ${matchedRequiredSkills}/${requiredSkills.length} required domain skills in transcript.`
    });
  } else if (requiredSkills.length > 0) {
    concerns.push({
      point: "Weak direct evidence for key JD domain skills",
      evidence: `Matched ${matchedRequiredSkills}/${requiredSkills.length} required domain skills in transcript.`
    });
  }

  if (strengths.length === 0) {
    strengths.push({
      point: "Baseline domain familiarity",
      evidence:
        "Candidate showed some domain understanding that can be clarified with follow-up probing."
    });
  }

  if (concerns.length === 0) {
    concerns.push({
      point: "Evidence of domain leadership remains limited",
      evidence:
        "Additional deep-dive scenarios are recommended before final decision."
    });
  }

  const artifact: InterviewerArtifact = {
    agentId,
    candidateId: payload.candidateId ?? "unknown-candidate",
    interviewId: payload.interviewId ?? "unknown-interview",
    timestamp: new Date().toISOString(),
    scores: {
      domainDepth: {
        score: domainDepthScore,
        jdRequirement: "Domain-specific architecture and execution depth",
        evidence: `Detected ${domainSignals} domain-risk signals and ${matchedRequiredSkills} JD skill matches in transcript evidence.`,
        justification:
          "Score reflects transcript evidence of domain-specific decisions, risk handling, and JD alignment."
      }
    },
    strengths,
    concerns,
    recommendation,
    recommendationRationale: `Domain assessment resulted in ${recommendation} based on transcript evidence and JD skill coverage.`,
    requiresApproval: true,
    questionsAsked: extractPanelQuestions(payload, candidateSummary)
  };

  return {
    handled: true,
    recommendation,
    summary: "Domain interview completed",
    artifact
  };
}
