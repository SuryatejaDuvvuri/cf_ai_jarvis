import { routeAgentRequest } from "agents";
import {
  Chat,
  OrchestratorAgent,
  RecruiterAgent,
  TechnicalInterviewerAgent,
  CultureInterviewerAgent,
  DomainExpertAgent
} from "@panelai/agents";
import { SharedMemoryDO } from "@panelai/core";
import type {
  CombinedScorecard,
  JobRequisition,
  RecruiterArtifact
} from "@panelai/shared";

type Decision = "hire" | "reject" | "follow-up";

interface CandidateRecord {
  id: string;
  jobId: string;
  status:
    | "applied"
    | "screening"
    | "shortlisted"
    | "approved"
    | "scheduled"
    | "rejected";
  resumeText?: string;
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
  recruiterArtifact?: RecruiterArtifact;
  decisionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface InterviewRecord {
  id: string;
  jobId: string;
  candidateId: string;
  status: "scheduled" | "in-progress" | "deliberation" | "completed";
  phase:
    | "scheduled"
    | "screening"
    | "technical"
    | "culture"
    | "domain"
    | "deliberation"
    | "completed";
  decision?: Decision;
  decidedBy?: string;
  decisionNotes?: string;
  createdAt: string;
  updatedAt: string;
}

interface SharedMemoryEntry<T> {
  key: string;
  value: T;
}

interface GreenhouseSyncData {
  handled?: boolean;
  source?: string;
  mode?: string;
  jobsImported?: number;
  candidatesImported?: number;
  jobs?: Array<{
    id: string | number;
    name?: string;
    status?: string;
  }>;
  candidates?: Array<{
    id: string | number;
    first_name?: string;
    last_name?: string;
    applications?: Array<{
      jobs?: Array<{ id: number; name?: string }>;
    }>;
  }>;
}

const JOB_SCOPE = "jobs";
const INTERVIEW_SCOPE = "interviews";
const JOB_IDS_KEY = "jobIds";
const INTERVIEW_IDS_KEY = "interviewIds";

function getSharedMemoryStub(env: Cloudflare.Env): DurableObjectStub {
  return env.SharedMemory.get(env.SharedMemory.idFromName("global"));
}

async function sharedGetValue<T>(
  sharedMemory: DurableObjectStub,
  scope: string,
  key: string
): Promise<T | null> {
  const response = await sharedMemory.fetch(
    `https://shared-memory/get?scope=${encodeURIComponent(scope)}&key=${encodeURIComponent(key)}`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Shared memory GET failed: ${response.status}`);
  }

  const payload = (await response.json()) as { value?: T } | null;
  return payload?.value ?? null;
}

async function sharedSetValue<T>(
  sharedMemory: DurableObjectStub,
  scope: string,
  key: string,
  value: T
): Promise<void> {
  const response = await sharedMemory.fetch("https://shared-memory/set", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      scope,
      key,
      value,
      options: { source: "worker-api" }
    })
  });

  if (!response.ok) {
    throw new Error(`Shared memory SET failed: ${response.status}`);
  }
}

async function sharedListValues<T>(
  sharedMemory: DurableObjectStub,
  scope: string,
  limit: number = 500
): Promise<Array<SharedMemoryEntry<T>>> {
  const response = await sharedMemory.fetch(
    `https://shared-memory/list?scope=${encodeURIComponent(scope)}&limit=${limit}`,
    { method: "GET" }
  );

  if (!response.ok) {
    throw new Error(`Shared memory LIST failed: ${response.status}`);
  }

  return (await response.json()) as Array<SharedMemoryEntry<T>>;
}

async function appendUniqueId(
  sharedMemory: DurableObjectStub,
  scope: string,
  key: string,
  value: string
): Promise<void> {
  const ids = (await sharedGetValue<string[]>(sharedMemory, scope, key)) ?? [];
  if (!ids.includes(value)) {
    ids.push(value);
    await sharedSetValue(sharedMemory, scope, key, ids);
  }
}

function mapGreenhouseStatus(status?: string): JobRequisition["status"] {
  const normalized = (status ?? "").trim().toLowerCase();
  if (!normalized) {
    return "open";
  }

  if (
    normalized.includes("open") ||
    normalized.includes("active") ||
    normalized.includes("published")
  ) {
    return "open";
  }

  if (normalized.includes("draft")) {
    return "draft";
  }

  if (normalized.includes("paused") || normalized.includes("hold")) {
    return "paused";
  }

  if (normalized.includes("filled") || normalized.includes("closed")) {
    return "filled";
  }

  return "open";
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Cloudflare.Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);
    const sharedMemory = getSharedMemoryStub(env);
    const envVars = env as unknown as Record<string, string | undefined>;

    if (url.pathname === "/api/provider/status") {
      const provider = (envVars.AI_PROVIDER ?? "workers-ai").toLowerCase();
      const model =
        envVars.AI_MODEL ??
        (provider === "workers-ai"
          ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
          : "llama-3.3-70b-versatile");
      const effectiveBaseUrl =
        (envVars.AI_BASE_URL ?? "").trim() ||
        (provider === "groq" ? "https://api.groq.com/openai/v1" : "");
      const configured =
        provider === "workers-ai"
          ? true
          : Boolean((envVars.AI_API_KEY ?? "").trim() && effectiveBaseUrl);

      return Response.json({
        success: configured,
        provider,
        model
      });
    }

    if (url.pathname === "/api/jobs" && request.method === "POST") {
      const now = new Date().toISOString();
      const body = (await request.json()) as Partial<JobRequisition>;

      const job: JobRequisition = {
        id: body.id ?? `job-${crypto.randomUUID()}`,
        title: body.title ?? "Untitled Role",
        department: body.department ?? "General",
        location: body.location ?? "Remote",
        remotePolicy: body.remotePolicy ?? "remote",
        employmentType: body.employmentType ?? "full-time",
        level: body.level ?? "mid",
        salaryRange: body.salaryRange,
        description: body.description ?? "",
        requiredSkills: body.requiredSkills ?? [],
        preferredSkills: body.preferredSkills ?? [],
        minYearsExperience: body.minYearsExperience ?? 0,
        hiringManager: body.hiringManager ?? "Unknown",
        recruiters: body.recruiters ?? [],
        status: body.status ?? "open",
        interviewConfig: body.interviewConfig,
        createdAt: now,
        updatedAt: now
      };

      await sharedSetValue(sharedMemory, JOB_SCOPE, `job:${job.id}`, job);
      await appendUniqueId(sharedMemory, JOB_SCOPE, JOB_IDS_KEY, job.id);

      return Response.json(job, { status: 201 });
    }

    if (url.pathname === "/api/jobs" && request.method === "GET") {
      const jobIds =
        (await sharedGetValue<string[]>(
          sharedMemory,
          JOB_SCOPE,
          JOB_IDS_KEY
        )) ?? [];

      const jobs = (
        await Promise.all(
          jobIds.map((jobId) =>
            sharedGetValue<JobRequisition>(
              sharedMemory,
              JOB_SCOPE,
              `job:${jobId}`
            )
          )
        )
      ).filter((job): job is JobRequisition => Boolean(job));

      return Response.json(jobs);
    }

    const jobByIdMatch = url.pathname.match(/^\/api\/jobs\/([^/]+)$/);
    if (jobByIdMatch && request.method === "GET") {
      const jobId = decodeURIComponent(jobByIdMatch[1]);
      const job = await sharedGetValue<JobRequisition>(
        sharedMemory,
        JOB_SCOPE,
        `job:${jobId}`
      );

      if (!job) {
        return Response.json({ error: "Job not found" }, { status: 404 });
      }

      return Response.json(job);
    }

    const jobCandidatesMatch = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/candidates$/
    );
    if (jobCandidatesMatch && request.method === "POST") {
      const jobId = decodeURIComponent(jobCandidatesMatch[1]);
      const job = await sharedGetValue<JobRequisition>(
        sharedMemory,
        JOB_SCOPE,
        `job:${jobId}`
      );
      if (!job) {
        return Response.json({ error: "Job not found" }, { status: 404 });
      }

      const body = (await request.json()) as {
        candidateId?: string;
        resumeText?: string;
        profile?: CandidateRecord["profile"];
      };

      const now = new Date().toISOString();
      const candidateId =
        body.candidateId ?? `candidate-${crypto.randomUUID()}`;

      let recruiterArtifact: RecruiterArtifact | undefined;
      if (body.resumeText?.trim()) {
        const recruiter = env.RECRUITER.get(
          env.RECRUITER.idFromName("agent-recruiter")
        );
        const recruiterResponse = await recruiter.fetch(
          "https://agent/delegate",
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              taskId: crypto.randomUUID(),
              type: "score-candidate",
              payload: {
                candidateId,
                resumeText: body.resumeText,
                profile: body.profile,
                job
              },
              from: { id: "worker", name: "Worker", role: "orchestrator" }
            })
          }
        );

        if (recruiterResponse.ok) {
          const scoringPayload = (await recruiterResponse.json()) as {
            data?: {
              artifact?: RecruiterArtifact;
            };
          };
          recruiterArtifact = scoringPayload.data?.artifact;
        }
      }

      const candidate: CandidateRecord = {
        id: candidateId,
        jobId,
        status: recruiterArtifact
          ? recruiterArtifact.recommendationBand === "not-recommended"
            ? "rejected"
            : "shortlisted"
          : "screening",
        resumeText: body.resumeText,
        profile: body.profile,
        recruiterArtifact,
        createdAt: now,
        updatedAt: now
      };

      await sharedSetValue(
        sharedMemory,
        `job:${jobId}`,
        `candidate:${candidateId}`,
        candidate
      );
      await appendUniqueId(
        sharedMemory,
        `job:${jobId}`,
        "candidateIds",
        candidateId
      );

      return Response.json(candidate, { status: 201 });
    }

    if (jobCandidatesMatch && request.method === "GET") {
      const jobId = decodeURIComponent(jobCandidatesMatch[1]);
      const entries = await sharedListValues<CandidateRecord>(
        sharedMemory,
        `job:${jobId}`
      );
      const candidates = entries
        .filter((entry) => entry.key.startsWith("candidate:"))
        .map((entry) => entry.value);
      return Response.json(candidates);
    }

    const candidateDecisionMatch = url.pathname.match(
      /^\/api\/jobs\/([^/]+)\/candidates\/([^/]+)\/(approve|reject)$/
    );
    if (candidateDecisionMatch && request.method === "POST") {
      const jobId = decodeURIComponent(candidateDecisionMatch[1]);
      const candidateId = decodeURIComponent(candidateDecisionMatch[2]);
      const action = candidateDecisionMatch[3] as "approve" | "reject";

      const existing = await sharedGetValue<CandidateRecord>(
        sharedMemory,
        `job:${jobId}`,
        `candidate:${candidateId}`
      );
      if (!existing) {
        return Response.json({ error: "Candidate not found" }, { status: 404 });
      }

      const body = (await request.json().catch(() => ({}))) as {
        reason?: string;
      };

      const updated: CandidateRecord = {
        ...existing,
        status: action === "approve" ? "approved" : "rejected",
        decisionNotes: body.reason,
        updatedAt: new Date().toISOString()
      };

      await sharedSetValue(
        sharedMemory,
        `job:${jobId}`,
        `candidate:${candidateId}`,
        updated
      );

      return Response.json(updated);
    }

    if (url.pathname === "/api/interviews" && request.method === "POST") {
      const body = (await request.json()) as {
        interviewId?: string;
        jobId: string;
        candidateId: string;
      };

      const job = await sharedGetValue<JobRequisition>(
        sharedMemory,
        JOB_SCOPE,
        `job:${body.jobId}`
      );
      if (!job) {
        return Response.json({ error: "Job not found" }, { status: 404 });
      }

      const candidate = await sharedGetValue<CandidateRecord>(
        sharedMemory,
        `job:${body.jobId}`,
        `candidate:${body.candidateId}`
      );
      if (!candidate) {
        return Response.json({ error: "Candidate not found" }, { status: 404 });
      }

      const now = new Date().toISOString();
      const interview: InterviewRecord = {
        id: body.interviewId ?? `interview-${crypto.randomUUID()}`,
        jobId: body.jobId,
        candidateId: body.candidateId,
        status: "scheduled",
        phase: "scheduled",
        createdAt: now,
        updatedAt: now
      };

      await sharedSetValue(
        sharedMemory,
        INTERVIEW_SCOPE,
        `interview:${interview.id}`,
        interview
      );
      await appendUniqueId(
        sharedMemory,
        INTERVIEW_SCOPE,
        INTERVIEW_IDS_KEY,
        interview.id
      );

      const updatedCandidate: CandidateRecord = {
        ...candidate,
        status: "scheduled",
        updatedAt: now
      };
      await sharedSetValue(
        sharedMemory,
        `job:${body.jobId}`,
        `candidate:${body.candidateId}`,
        updatedCandidate
      );

      const orchestrator = env.ORCHESTRATOR.get(
        env.ORCHESTRATOR.idFromName("agent-orchestrator")
      );
      await orchestrator.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "start-interview",
          payload: {
            interviewId: interview.id,
            candidateProfile: candidate.profile ?? candidate,
            jobRequisition: job
          },
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
      });

      return Response.json(interview, { status: 201 });
    }

    if (url.pathname === "/api/interviews" && request.method === "GET") {
      const interviewIds =
        (await sharedGetValue<string[]>(
          sharedMemory,
          INTERVIEW_SCOPE,
          INTERVIEW_IDS_KEY
        )) ?? [];

      const interviews = (
        await Promise.all(
          interviewIds.map((id) =>
            sharedGetValue<InterviewRecord>(
              sharedMemory,
              INTERVIEW_SCOPE,
              `interview:${id}`
            )
          )
        )
      ).filter((entry): entry is InterviewRecord => Boolean(entry));

      return Response.json(interviews);
    }

    const interviewByIdMatch = url.pathname.match(
      /^\/api\/interviews\/([^/]+)$/
    );
    if (interviewByIdMatch && request.method === "GET") {
      const interviewId = decodeURIComponent(interviewByIdMatch[1]);
      const interview = await sharedGetValue<InterviewRecord>(
        sharedMemory,
        INTERVIEW_SCOPE,
        `interview:${interviewId}`
      );
      if (!interview) {
        return Response.json({ error: "Interview not found" }, { status: 404 });
      }

      const scorecardEntry = await sharedGetValue<CombinedScorecard>(
        sharedMemory,
        `interview:${interviewId}`,
        "combinedScorecard"
      );

      return Response.json({
        ...interview,
        scorecard: scorecardEntry ?? null
      });
    }

    const interviewScorecardMatch = url.pathname.match(
      /^\/api\/interviews\/([^/]+)\/scorecard$/
    );
    if (interviewScorecardMatch && request.method === "GET") {
      const interviewId = decodeURIComponent(interviewScorecardMatch[1]);
      const scorecard = await sharedGetValue<CombinedScorecard>(
        sharedMemory,
        `interview:${interviewId}`,
        "combinedScorecard"
      );

      if (!scorecard) {
        return Response.json(
          { error: "Scorecard not found for interview" },
          { status: 404 }
        );
      }

      return Response.json(scorecard);
    }

    const interviewDecisionMatch = url.pathname.match(
      /^\/api\/interviews\/([^/]+)\/decision$/
    );
    if (interviewDecisionMatch && request.method === "POST") {
      const interviewId = decodeURIComponent(interviewDecisionMatch[1]);
      const payload = (await request.json()) as {
        decision: Decision;
        decidedBy: string;
        notes?: string;
      };

      const orchestrator = env.ORCHESTRATOR.get(
        env.ORCHESTRATOR.idFromName("agent-orchestrator")
      );
      const orchestratorResponse = await orchestrator.fetch(
        "https://agent/delegate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: crypto.randomUUID(),
            type: "finalize-human-decision",
            payload: {
              interviewId,
              decision: payload.decision,
              decidedBy: payload.decidedBy,
              notes: payload.notes
            },
            from: { id: "worker", name: "Worker", role: "orchestrator" }
          })
        }
      );

      const existing = await sharedGetValue<InterviewRecord>(
        sharedMemory,
        INTERVIEW_SCOPE,
        `interview:${interviewId}`
      );
      if (existing) {
        const updated: InterviewRecord = {
          ...existing,
          status: "completed",
          phase: "completed",
          decision: payload.decision,
          decidedBy: payload.decidedBy,
          decisionNotes: payload.notes,
          updatedAt: new Date().toISOString()
        };

        await sharedSetValue(
          sharedMemory,
          INTERVIEW_SCOPE,
          `interview:${interviewId}`,
          updated
        );
      }

      const orchestratorPayload = await orchestratorResponse
        .json()
        .catch(() => null);
      return Response.json({
        success: orchestratorResponse.ok,
        interviewId,
        decision: payload.decision,
        orchestrator: orchestratorPayload
      });
    }

    if (url.pathname === "/transcribe" && request.method === "POST") {
      try {
        const formData = await request.formData();
        const audioFile = formData.get("audio") as File;

        if (!audioFile) {
          return Response.json({ error: "No file provided." }, { status: 400 });
        }

        const buffer = await audioFile.arrayBuffer();
        const result = await env.AI.run("@cf/openai/whisper", {
          audio: [...new Uint8Array(buffer)]
        });

        return Response.json({ text: result.text });
      } catch (error) {
        console.error("Transcription error: ", error);
        return Response.json(
          { error: "Transcription failed" },
          { status: 400 }
        );
      }
    }

    if (url.pathname === "/speak" && request.method === "POST") {
      try {
        const { text, voice } = (await request.json()) as {
          text?: string;
          voice?: string;
        };
        if (!text) {
          return Response.json({ error: "No text provided" }, { status: 400 });
        }

        const cleanText = text.replace(/\[MEMORY:[^\]]+\]/g, "").trim();

        // Allowlist of valid Deepgram Aura speakers — one per panel agent
        const allowedSpeakers = [
          "angus",
          "asteria",
          "arcas",
          "orion",
          "orpheus",
          "athena",
          "luna",
          "zeus",
          "perseus",
          "helios",
          "hera",
          "stella"
        ] as const;
        type AuraSpeaker = (typeof allowedSpeakers)[number];
        const isAuraSpeaker = (value: string): value is AuraSpeaker =>
          (allowedSpeakers as readonly string[]).includes(value);
        const speaker: AuraSpeaker =
          voice && isAuraSpeaker(voice) ? voice : "arcas";

        const result = await env.AI.run(
          "@cf/deepgram/aura-1",
          { text: cleanText, speaker },
          { returnRawResponse: true }
        );

        return result;
      } catch (error) {
        console.error("TTS error: ", error);
        return Response.json(
          { error: "Speech synthesis failed" },
          { status: 500 }
        );
      }
    }

    if (url.pathname === "/api/greenhouse/sync" && request.method === "POST") {
      const orchestrator = env.RECRUITER.get(
        env.RECRUITER.idFromName("agent-recruiter")
      );
      const response = await orchestrator.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "sync-greenhouse",
          payload: {},
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
      });
      return response;
    }

    if (
      url.pathname === "/api/ats/greenhouse/import" &&
      request.method === "POST"
    ) {
      const recruiter = env.RECRUITER.get(
        env.RECRUITER.idFromName("agent-recruiter")
      );
      const syncResponse = await recruiter.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "sync-greenhouse-data",
          payload: {},
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
      });

      if (!syncResponse.ok) {
        return Response.json(
          { error: "Failed to sync Greenhouse data" },
          { status: syncResponse.status }
        );
      }

      const syncPayload = (await syncResponse.json()) as {
        data?: GreenhouseSyncData;
      };
      const syncData = syncPayload.data;

      if (!syncData?.handled) {
        return Response.json(
          {
            error: "Greenhouse sync was not handled",
            data: syncData ?? null
          },
          { status: 400 }
        );
      }

      const now = new Date().toISOString();
      const greenhouseJobs = syncData.jobs ?? [];
      const greenhouseCandidates = syncData.candidates ?? [];

      const greenhouseToLocalJobId = new Map<string, string>();

      let jobsCreated = 0;
      let jobsUpdated = 0;
      for (const greenhouseJob of greenhouseJobs) {
        const greenhouseJobId = String(greenhouseJob.id);
        const localJobId = `gh-job-${greenhouseJobId}`;
        const existingJob = await sharedGetValue<JobRequisition>(
          sharedMemory,
          JOB_SCOPE,
          `job:${localJobId}`
        );

        const title =
          greenhouseJob.name?.trim() || `Greenhouse Job ${greenhouseJobId}`;
        const nextJob: JobRequisition = {
          id: localJobId,
          title,
          department: existingJob?.department ?? "Imported from ATS",
          location: existingJob?.location ?? "TBD",
          remotePolicy: existingJob?.remotePolicy ?? "remote",
          employmentType: existingJob?.employmentType ?? "full-time",
          level: existingJob?.level ?? "mid",
          salaryRange: existingJob?.salaryRange,
          description:
            existingJob?.description &&
            existingJob.description.trim().length > 0
              ? existingJob.description
              : `Imported from Greenhouse: ${title}`,
          requiredSkills: existingJob?.requiredSkills ?? [],
          preferredSkills: existingJob?.preferredSkills ?? [],
          minYearsExperience: existingJob?.minYearsExperience ?? 0,
          hiringManager: existingJob?.hiringManager ?? "ATS Import",
          recruiters: existingJob?.recruiters ?? [],
          status: mapGreenhouseStatus(greenhouseJob.status),
          interviewConfig: existingJob?.interviewConfig,
          createdAt: existingJob?.createdAt ?? now,
          updatedAt: now
        };

        await sharedSetValue(
          sharedMemory,
          JOB_SCOPE,
          `job:${localJobId}`,
          nextJob
        );
        await appendUniqueId(sharedMemory, JOB_SCOPE, JOB_IDS_KEY, localJobId);
        greenhouseToLocalJobId.set(greenhouseJobId, localJobId);

        if (existingJob) {
          jobsUpdated += 1;
        } else {
          jobsCreated += 1;
        }
      }

      let candidatesCreated = 0;
      let candidatesUpdated = 0;
      for (const greenhouseCandidate of greenhouseCandidates) {
        const applicationJobs = (
          greenhouseCandidate.applications ?? []
        ).flatMap((application) => application.jobs ?? []);
        const matchedJob = applicationJobs.find((job) =>
          greenhouseToLocalJobId.has(String(job.id))
        );

        if (!matchedJob) {
          continue;
        }

        const localJobId = greenhouseToLocalJobId.get(String(matchedJob.id));
        if (!localJobId) {
          continue;
        }

        const localCandidateId = `gh-candidate-${String(greenhouseCandidate.id)}`;
        const existingCandidate = await sharedGetValue<CandidateRecord>(
          sharedMemory,
          `job:${localJobId}`,
          `candidate:${localCandidateId}`
        );

        const fullName = [
          greenhouseCandidate.first_name ?? "",
          greenhouseCandidate.last_name ?? ""
        ]
          .join(" ")
          .trim();

        const nextCandidate: CandidateRecord = {
          id: localCandidateId,
          jobId: localJobId,
          status: existingCandidate?.status ?? "screening",
          resumeText: existingCandidate?.resumeText,
          profile: {
            name:
              fullName ||
              existingCandidate?.profile?.name ||
              `Greenhouse Candidate ${greenhouseCandidate.id}`,
            email: existingCandidate?.profile?.email,
            phone: existingCandidate?.profile?.phone,
            skills: existingCandidate?.profile?.skills,
            yearsExperience: existingCandidate?.profile?.yearsExperience,
            projects: existingCandidate?.profile?.projects,
            certifications: existingCandidate?.profile?.certifications,
            workAuthorization: existingCandidate?.profile?.workAuthorization
          },
          recruiterArtifact: existingCandidate?.recruiterArtifact,
          decisionNotes: existingCandidate?.decisionNotes,
          createdAt: existingCandidate?.createdAt ?? now,
          updatedAt: now
        };

        await sharedSetValue(
          sharedMemory,
          `job:${localJobId}`,
          `candidate:${localCandidateId}`,
          nextCandidate
        );
        await appendUniqueId(
          sharedMemory,
          `job:${localJobId}`,
          "candidateIds",
          localCandidateId
        );

        if (existingCandidate) {
          candidatesUpdated += 1;
        } else {
          candidatesCreated += 1;
        }
      }

      return Response.json({
        success: true,
        source: "greenhouse",
        jobsDiscovered: greenhouseJobs.length,
        candidatesDiscovered: greenhouseCandidates.length,
        jobsCreated,
        jobsUpdated,
        candidatesCreated,
        candidatesUpdated
      });
    }

    if (url.pathname === "/api/recruiter/score" && request.method === "POST") {
      const payload = (await request.json()) as {
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

      const recruiter = env.RECRUITER.get(
        env.RECRUITER.idFromName("agent-recruiter")
      );
      return recruiter.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "score-candidate",
          payload,
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
      });
    }

    if (
      url.pathname === "/api/orchestrator/advance" &&
      request.method === "POST"
    ) {
      const payload = (await request.json()) as {
        interviewId: string;
        recruiterArtifact: RecruiterArtifact;
      };
      const orchestrator = env.ORCHESTRATOR.get(
        env.ORCHESTRATOR.idFromName("agent-orchestrator")
      );
      return orchestrator.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "advance-from-recruiter",
          payload,
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
      });
    }

    if (
      url.pathname === "/api/interview/run-panel" &&
      request.method === "POST"
    ) {
      const payload = (await request.json()) as {
        interviewId: string;
        candidateId: string;
      };

      const existingInterview = await sharedGetValue<InterviewRecord>(
        sharedMemory,
        INTERVIEW_SCOPE,
        `interview:${payload.interviewId}`
      );

      if (!existingInterview) {
        return Response.json({ error: "Interview not found" }, { status: 404 });
      }

      const inProgressInterview: InterviewRecord = {
        ...existingInterview,
        status: "in-progress",
        phase:
          existingInterview.phase === "scheduled"
            ? "technical"
            : existingInterview.phase,
        updatedAt: new Date().toISOString()
      };

      await sharedSetValue(
        sharedMemory,
        INTERVIEW_SCOPE,
        `interview:${payload.interviewId}`,
        inProgressInterview
      );

      const orchestrator = env.ORCHESTRATOR.get(
        env.ORCHESTRATOR.idFromName("agent-orchestrator")
      );
      const orchestratorResponse = await orchestrator.fetch(
        "https://agent/delegate",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            taskId: crypto.randomUUID(),
            type: "run-panel-interview",
            payload,
            from: { id: "worker", name: "Worker", role: "orchestrator" }
          })
        }
      );

      if (!orchestratorResponse.ok) {
        return Response.json(
          {
            success: false,
            error: "Failed to run panel interview delegation"
          },
          { status: orchestratorResponse.status }
        );
      }

      const deliberationInterview: InterviewRecord = {
        ...inProgressInterview,
        status: "deliberation",
        phase: "deliberation",
        updatedAt: new Date().toISOString()
      };

      await sharedSetValue(
        sharedMemory,
        INTERVIEW_SCOPE,
        `interview:${payload.interviewId}`,
        deliberationInterview
      );

      const orchestratorPayload = await orchestratorResponse
        .json()
        .catch(() => null);

      return Response.json({
        success: true,
        interview: deliberationInterview,
        orchestrator: orchestratorPayload
      });
    }

    if (url.pathname === "/api/human-decision" && request.method === "POST") {
      const payload = (await request.json()) as {
        interviewId: string;
        decision: "hire" | "reject" | "follow-up";
        decidedBy: string;
        notes?: string;
      };
      const orchestrator = env.ORCHESTRATOR.get(
        env.ORCHESTRATOR.idFromName("agent-orchestrator")
      );
      return orchestrator.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "finalize-human-decision",
          payload,
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
      });
    }

    if (
      url.pathname === "/api/candidate/feedback" &&
      request.method === "GET"
    ) {
      const interviewId = url.searchParams.get("interviewId");
      if (!interviewId) {
        return Response.json({ error: "Missing interviewId" }, { status: 400 });
      }
      const sharedMemory = env.SharedMemory.get(
        env.SharedMemory.idFromName("global")
      );
      const response = await sharedMemory.fetch(
        `https://shared-memory/get?scope=interview:${interviewId}&key=candidateCoachingSummary`,
        { method: "GET" }
      );
      return response;
    }

    if (
      url.pathname === "/api/dashboard/interview" &&
      request.method === "GET"
    ) {
      const interviewId = url.searchParams.get("interviewId");
      if (!interviewId) {
        return Response.json({ error: "Missing interviewId" }, { status: 400 });
      }
      const sharedMemory = env.SharedMemory.get(
        env.SharedMemory.idFromName("global")
      );
      const response = await sharedMemory.fetch(
        `https://shared-memory/get?scope=interview:${interviewId}&key=combinedScorecard`,
        { method: "GET" }
      );
      if (!response.ok) {
        return response;
      }
      const entry = (await response.json()) as {
        value?: CombinedScorecard;
      } | null;
      return Response.json(entry?.value ?? null);
    }

    // Let agent routes resolve first.
    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    // Fall back to static assets / SPA shell for UI routes.
    const assets = (env as unknown as { ASSETS?: Fetcher }).ASSETS;
    if (assets && request.method === "GET") {
      return assets.fetch(request);
    }

    return new Response("Not found", { status: 404 });
  }
} satisfies ExportedHandler<Cloudflare.Env>;

// Export the Chat Durable Object class for wrangler to bind
export { Chat };
export { OrchestratorAgent };
export { RecruiterAgent };
export { TechnicalInterviewerAgent };
export { CultureInterviewerAgent };
export { DomainExpertAgent };
export { SharedMemoryDO };
