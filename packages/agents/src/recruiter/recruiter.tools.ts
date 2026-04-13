import type { JobRequisition } from "@panelai/shared";
import { GreenhouseClient } from "./greenhouse.client.js";
import { scoreCandidateForJob } from "./recruiter.scoring.js";

export interface RecruiterCandidateProfile {
  name?: string;
  email?: string;
  phone?: string;
  skills?: string[];
  yearsExperience?: number;
  projects?: string[];
  certifications?: string[];
  workAuthorization?: "authorized" | "requires-sponsorship" | "unknown";
}

export interface ScoreCandidatePayload {
  candidateId: string;
  resumeText: string;
  profile?: RecruiterCandidateProfile;
  job: JobRequisition;
}

export async function syncGreenhouseReadOnly(apiKey: string) {
  const greenhouse = new GreenhouseClient({ apiKey });

  const [jobs, candidates] = await Promise.all([
    greenhouse.listJobs(),
    greenhouse.listCandidates()
  ]);

  return {
    handled: true,
    source: "greenhouse",
    mode: "read-only",
    jobsImported: jobs.length,
    candidatesImported: candidates.length
  };
}

export function scoreCandidate(payload: ScoreCandidatePayload) {
  const artifact = scoreCandidateForJob({
    candidateId: payload.candidateId,
    jobId: payload.job.id,
    resumeText: payload.resumeText,
    profile: payload.profile,
    job: payload.job
  });

  return {
    handled: true,
    recommendation: artifact.recommendationBand,
    score: artifact.weightedScore,
    requiresApproval: artifact.requiresApproval,
    artifact
  };
}
