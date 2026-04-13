import type { JobRequisition } from "@panelai/shared";
import { GreenhouseClient } from "./greenhouse.client.js";
import { scoreCandidateForJob } from "./recruiter.scoring.js";

export interface GreenhouseSyncSnapshot {
  jobs: Awaited<ReturnType<GreenhouseClient["listJobs"]>>;
  candidates: Awaited<ReturnType<GreenhouseClient["listCandidates"]>>;
}

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
  const snapshot = await syncGreenhouseWithData(apiKey);

  return {
    handled: true,
    source: "greenhouse",
    mode: "read-only",
    jobsImported: snapshot.jobs.length,
    candidatesImported: snapshot.candidates.length
  };
}

export async function syncGreenhouseWithData(
  apiKey: string
): Promise<GreenhouseSyncSnapshot> {
  const greenhouse = new GreenhouseClient({ apiKey });

  const [jobs, candidates] = await Promise.all([
    greenhouse.listJobs(),
    greenhouse.listCandidates()
  ]);

  return { jobs, candidates };
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
