/**
 * Recruiter Agent
 *
 * Handles the pre-interview pipeline: resume parsing, candidate scoring,
 * and shortlist recommendations. Works BEFORE the panel interview begins.
 *
 * Responsibilities:
 * - Parse resumes (PDF, DOCX, plain text)
 * - Score candidates against job requirements
 * - Generate shortlist with rationale
 * - Present recommendations to human recruiter for approval
 * - Schedule approved candidates for panel interviews
 */

import {
  CoreAgent,
  type CoreAgentEnv,
  type DelegationMessage
} from "@panelai/core";
import type { AgentRole, JobRequisition } from "@panelai/shared";
import { GreenhouseClient } from "./greenhouse.client.js";
import { scoreCandidateForJob } from "./recruiter.scoring.js";

interface RecruiterEnv extends CoreAgentEnv {
  GREENHOUSE_API_KEY: string;
}

export class RecruiterAgent extends CoreAgent<RecruiterEnv> {
  protected get role(): AgentRole {
    return "recruiter";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "sync-greenhouse") {
      if (!this.env.GREENHOUSE_API_KEY) {
        return {
          handled: false,
          error: "Missing GREENHOUSE_API_KEY binding."
        };
      }

      const greenhouse = new GreenhouseClient({
        apiKey: this.env.GREENHOUSE_API_KEY
      });

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

    if (message.type === "score-candidate") {
      const payload = message.payload as {
        candidateId: string;
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
      };

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

    return super.onDelegation(message);
  }
}
