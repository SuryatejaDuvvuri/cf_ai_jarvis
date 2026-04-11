import type { JobRequisition, RecruiterArtifact } from "@panelai/shared";

export interface RecruiterScoreInput {
  candidateId: string;
  jobId: string;
  resumeText: string;
  profile?: {
    name?: string;
    email?: string;
    phone?: string;
    skills?: string[];
    yearsExperience?: number;
    projects?: string[];
    certifications?: string[];
    workAuthorization?: "authorized" | "requires-sponsorship" | "unknown";
  };
  job: JobRequisition;
}

const WEIGHTS = {
  relevantExperience: 35,
  projectImpact: 30,
  communicationClarity: 20,
  skills: 15
} as const;

function clamp(value: number, min = 0, max = 100): number {
  return Math.max(min, Math.min(max, value));
}

function scoreRelevantExperience(input: RecruiterScoreInput): number {
  const years = input.profile?.yearsExperience ?? 0;
  const minYears = input.job.minYearsExperience ?? 0;
  if (minYears <= 0) return 75;
  const ratio = years / minYears;
  if (ratio >= 1.2) return 92;
  if (ratio >= 1) return 85;
  if (ratio >= 0.8) return 70;
  if (ratio >= 0.5) return 55;
  return 35;
}

function scoreProjectImpact(input: RecruiterScoreInput): number {
  const projectCount = input.profile?.projects?.length ?? 0;
  if (projectCount >= 4) return 90;
  if (projectCount >= 2) return 78;
  if (projectCount >= 1) return 65;
  return 40;
}

function scoreCommunicationClarity(input: RecruiterScoreInput): number {
  const text = input.resumeText.trim();
  if (text.length > 4000) return 84;
  if (text.length > 2000) return 75;
  if (text.length > 800) return 64;
  return 45;
}

function scoreSkills(input: RecruiterScoreInput): number {
  const candidateSkills = new Set(
    (input.profile?.skills ?? []).map((s) => s.toLowerCase())
  );
  const requiredSkills = input.job.requiredSkills.map((s) => s.toLowerCase());
  if (requiredSkills.length === 0) return 70;

  const matched = requiredSkills.filter((s) => candidateSkills.has(s)).length;
  const ratio = matched / requiredSkills.length;
  if (ratio >= 0.9) return 90;
  if (ratio >= 0.7) return 78;
  if (ratio >= 0.5) return 63;
  return 42;
}

function detectHardKnockouts(input: RecruiterScoreInput): string[] {
  const reasons: string[] = [];
  const auth = input.profile?.workAuthorization;
  if (auth === "requires-sponsorship") {
    reasons.push("Work authorization/visa mismatch for this role.");
  }

  const certs = new Set(
    (input.profile?.certifications ?? []).map((c) => c.toLowerCase())
  );
  const mandatoryCerts = input.job.preferredSkills
    .filter((s) => s.toLowerCase().includes("cert"))
    .map((s) => s.toLowerCase());
  const missingMandatory = mandatoryCerts.filter((c) => !certs.has(c));
  if (missingMandatory.length > 0) {
    reasons.push(
      `Missing mandatory certifications: ${missingMandatory.join(", ")}.`
    );
  }
  return reasons;
}

function detectPenalties(
  input: RecruiterScoreInput,
  breakdown: RecruiterArtifact["scoreBreakdown"]
): { reasons: string[]; penaltyPoints: number } {
  const reasons: string[] = [];
  let penaltyPoints = 0;

  if (breakdown.relevantExperience < 60) {
    reasons.push(
      "Experience appears below target level for this role; keeping profile in consideration with reduced confidence."
    );
    penaltyPoints += 10;
  }

  const candidateSkills = new Set(
    (input.profile?.skills ?? []).map((s) => s.toLowerCase())
  );
  const requiredSkills = input.job.requiredSkills.map((s) => s.toLowerCase());
  const matched = requiredSkills.filter((s) => candidateSkills.has(s)).length;
  const jdAlignment =
    requiredSkills.length === 0 ? 1 : matched / requiredSkills.length;
  if (jdAlignment < 0.5) {
    reasons.push(
      "Resume currently shows weak alignment to JD-required skills; recommending targeted upskilling and project alignment."
    );
    penaltyPoints += 15;
  }

  return { reasons, penaltyPoints };
}

function getRecommendationBand(
  weightedScore: number
): RecruiterArtifact["recommendationBand"] {
  if (weightedScore >= 80) return "recommended";
  if (weightedScore >= 60) return "maybe";
  return "not-recommended";
}

function getFitTier(weightedScore: number): RecruiterArtifact["fitTier"] {
  if (weightedScore >= 80) return "strong-fit";
  if (weightedScore >= 60) return "potential-fit";
  return "not-a-match";
}

export function scoreCandidateForJob(
  input: RecruiterScoreInput
): RecruiterArtifact {
  const breakdown: RecruiterArtifact["scoreBreakdown"] = {
    relevantExperience: scoreRelevantExperience(input),
    projectImpact: scoreProjectImpact(input),
    communicationClarity: scoreCommunicationClarity(input),
    skills: scoreSkills(input)
  };

  const hardKnockouts = detectHardKnockouts(input);
  const penalties = detectPenalties(input, breakdown);

  const weightedBeforePenalty =
    (breakdown.relevantExperience * WEIGHTS.relevantExperience +
      breakdown.projectImpact * WEIGHTS.projectImpact +
      breakdown.communicationClarity * WEIGHTS.communicationClarity +
      breakdown.skills * WEIGHTS.skills) /
    100;

  const weightedScore = clamp(weightedBeforePenalty - penalties.penaltyPoints);
  const recommendationBand =
    hardKnockouts.length > 0
      ? "not-recommended"
      : getRecommendationBand(weightedScore);
  const fitTier =
    hardKnockouts.length > 0 ? "not-a-match" : getFitTier(weightedScore);

  const requiredSkills = input.job.requiredSkills;
  const candidateSkills = input.profile?.skills ?? [];
  const matchedSkills = requiredSkills.filter((s) =>
    candidateSkills.map((c) => c.toLowerCase()).includes(s.toLowerCase())
  );

  return {
    candidateId: input.candidateId,
    jobId: input.jobId,
    timestamp: new Date().toISOString(),
    parsedResume: {
      name: input.profile?.name ?? "Unknown Candidate",
      email: input.profile?.email,
      phone: input.profile?.phone,
      skills: candidateSkills,
      experience: [],
      education: [],
      totalYearsExperience: input.profile?.yearsExperience ?? 0
    },
    matchScores: {
      relevantExperience: {
        score:
          (Math.round(breakdown.relevantExperience / 25) as
            | 1
            | 2
            | 3
            | 4
            | 5) || 1,
        jdRequirement: `At least ${input.job.minYearsExperience} years relevant experience`,
        evidence: `Estimated ${input.profile?.yearsExperience ?? 0} years from resume/profile`,
        justification:
          "Experience fit score normalized from profile to JD expectation."
      },
      projectImpact: {
        score:
          (Math.round(breakdown.projectImpact / 25) as 1 | 2 | 3 | 4 | 5) || 1,
        jdRequirement: "Demonstrable project outcomes and ownership",
        evidence: `${input.profile?.projects?.length ?? 0} project entries detected`,
        justification: "Project impact score based on project evidence density."
      },
      communicationClarity: {
        score:
          (Math.round(breakdown.communicationClarity / 25) as
            | 1
            | 2
            | 3
            | 4
            | 5) || 1,
        jdRequirement: "Clear communication of experience and outcomes",
        evidence: `Resume text length ${input.resumeText.length} characters`,
        justification:
          "Communication clarity proxy derived from structural resume completeness."
      },
      skills: {
        score: (Math.round(breakdown.skills / 25) as 1 | 2 | 3 | 4 | 5) || 1,
        jdRequirement: `Required skills: ${requiredSkills.join(", ")}`,
        evidence: `Matched skills: ${matchedSkills.join(", ") || "none"}`,
        justification: "Skills score based on overlap with JD required skills."
      }
    },
    weightedScore,
    scoreBreakdown: breakdown,
    fitTier,
    recommendationBand,
    fitRationale:
      hardKnockouts.length > 0
        ? `Not recommended due to hard knockout criteria: ${hardKnockouts.join(" ")}`
        : `Weighted score ${weightedScore.toFixed(1)} (${recommendationBand}).`,
    areasToProbe: [
      "Depth of real-world project ownership",
      "Communication under ambiguity",
      "Role-specific technical readiness"
    ],
    redFlags: [...hardKnockouts],
    hardKnockouts,
    penalties: penalties.reasons,
    candidateCoachingSummary: {
      strengths: [
        "Relevant experiences identified in profile.",
        "Detected projects that can be framed for impact."
      ],
      growthAreas: [
        "Improve resume evidence for JD-critical requirements.",
        "Increase clarity and quantification of project outcomes."
      ],
      actionableNextSteps: [
        "Rewrite project bullets with measurable outcomes (impact, scope, metrics).",
        "Highlight closest JD-aligned experience near the top of the resume.",
        "Add concise role-summary tailored to the specific job posting."
      ],
      encouragingSummary:
        "You have a foundation to build on. With clearer impact framing and tighter JD alignment, your interview readiness can improve significantly."
    },
    requiresApproval: true
  };
}
