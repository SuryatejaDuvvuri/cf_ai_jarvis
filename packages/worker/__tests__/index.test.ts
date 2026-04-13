import {
  env,
  createExecutionContext,
  waitOnExecutionContext
} from "cloudflare:test";
import { describe, it, expect } from "vitest";
// Could import any other source file/function here
import worker from "../src/index";

declare module "cloudflare:test" {
  // Controls the type of `import("cloudflare:test").env`
  interface ProvidedEnv extends Cloudflare.Env {}
}

describe("Chat worker", () => {
  it("responds with Not found", async () => {
    const request = new Request("http://example.com");
    // Create an empty context to pass to `worker.fetch()`
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    // Wait for all `Promise`s passed to `ctx.waitUntil()` to settle before running test assertions
    await waitOnExecutionContext(ctx);
    expect(await response.text()).toBe("Not found");
    expect(response.status).toBe(404);
  });

  it("returns healthy status for /api/provider/status", async () => {
    const request = new Request("http://example.com/api/provider/status");
    const ctx = createExecutionContext();
    const response = await worker.fetch(request, env, ctx);
    await waitOnExecutionContext(ctx);

    expect(response.status).toBe(200);
    await expect(response.json()).resolves.toMatchObject({
      success: true,
      provider: "workers-ai"
    });
  });

  it("delegates from orchestrator to technical agent", async () => {
    const orchestratorStub = env.ORCHESTRATOR.get(
      env.ORCHESTRATOR.idFromName("agent-orchestrator")
    );

    const response = await orchestratorStub.fetch("https://agent/delegate", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        taskId: "task-1",
        type: "start-interview",
        payload: {
          interviewId: "iv-1",
          candidateProfile: { name: "Alex" },
          jobRequisition: { role: "Engineer" }
        },
        from: { id: "user-1", name: "User", role: "jarvis" }
      })
    });

    expect(response.status).toBe(200);
    const result = (await response.json()) as {
      data: { handled: boolean; phase: string };
    };
    expect(result.data.handled).toBe(true);
    expect(result.data.phase).toBe("screening");
  });

  it("scores candidate via recruiter API and returns artifact", async () => {
    const now = new Date().toISOString();
    const response = await worker.fetch(
      new Request("http://example.com/api/recruiter/score", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId: "c-1",
          resumeText:
            "Candidate with project impact and communication examples.",
          profile: {
            name: "Alex",
            skills: ["TypeScript", "React"],
            yearsExperience: 2,
            projects: ["Shipped dashboard"],
            workAuthorization: "authorized"
          },
          job: {
            id: "job-1",
            title: "Engineer",
            department: "Engineering",
            location: "Remote",
            remotePolicy: "remote",
            employmentType: "full-time",
            level: "entry",
            description: "Build product features.",
            requiredSkills: ["TypeScript", "React"],
            preferredSkills: [],
            minYearsExperience: 3,
            hiringManager: "hm",
            recruiters: ["r1"],
            status: "open",
            createdAt: now,
            updatedAt: now
          }
        })
      }),
      env,
      createExecutionContext()
    );

    expect(response.status).toBe(200);
    const body = (await response.json()) as {
      data?: {
        artifact?: { weightedScore: number; recommendationBand: string };
      };
    };
    expect(body.data?.artifact?.weightedScore).toBeTypeOf("number");
    expect(body.data?.artifact?.recommendationBand).toBeTypeOf("string");
  });

  it("validates candidate feedback route params", async () => {
    const feedbackResponse = await worker.fetch(
      new Request("http://example.com/api/candidate/feedback"),
      env,
      createExecutionContext()
    );
    expect(feedbackResponse.status).toBe(400);
    await expect(feedbackResponse.json()).resolves.toEqual({
      error: "Missing interviewId"
    });
  });

  it("returns dashboard validation error when interviewId is missing", async () => {
    const dashboardResponse = await worker.fetch(
      new Request("http://example.com/api/dashboard/interview"),
      env,
      createExecutionContext()
    );
    expect(dashboardResponse.status).toBe(400);
    await expect(dashboardResponse.json()).resolves.toEqual({
      error: "Missing interviewId"
    });
  });

  it("returns handled=false when final decision has no scorecard", async () => {
    const decisionResponse = await worker.fetch(
      new Request("http://example.com/api/human-decision", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          interviewId: "iv-nonexistent",
          decision: "hire",
          decidedBy: "reviewer-1",
          notes: "Strong panel outcome."
        })
      }),
      env,
      createExecutionContext()
    );
    expect(decisionResponse.status).toBe(200);
    const json = (await decisionResponse.json()) as {
      data?: { handled?: boolean; error?: string };
    } | null;
    expect(json?.data?.handled).toBe(false);
    expect(json?.data?.error).toBe(
      "No combined scorecard found for interview."
    );
  });

  it.skip("executes jobs-to-decision route flow end-to-end", async () => {
    const jobId = `job-e2e-${crypto.randomUUID()}`;
    const candidateId = `candidate-e2e-${crypto.randomUUID()}`;
    const interviewId = `interview-e2e-${crypto.randomUUID()}`;

    const callWorker = async (request: Request) => {
      const ctx = createExecutionContext();
      const response = await worker.fetch(request, env, ctx);
      await waitOnExecutionContext(ctx);
      return response;
    };

    const createJobResponse = await callWorker(
      new Request("http://example.com/api/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          id: jobId,
          title: "Senior Frontend Engineer",
          department: "Engineering",
          location: "Remote",
          remotePolicy: "remote",
          employmentType: "full-time",
          level: "senior",
          description: "Build and ship user-facing product features.",
          requiredSkills: ["TypeScript", "React"],
          preferredSkills: ["Cloudflare Workers"],
          minYearsExperience: 5,
          hiringManager: "hm-1",
          recruiters: ["rec-1"],
          status: "open"
        })
      })
    );
    expect(createJobResponse.status).toBe(201);

    const addCandidateResponse = await callWorker(
      new Request(`http://example.com/api/jobs/${jobId}/candidates`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          candidateId,
          resumeText:
            "Built production React apps with strong collaboration and ownership.",
          profile: {
            name: "Taylor",
            skills: ["TypeScript", "React"],
            yearsExperience: 6,
            projects: ["Scaled design system"],
            workAuthorization: "authorized"
          }
        })
      })
    );
    expect(addCandidateResponse.status).toBe(201);
    const candidate = (await addCandidateResponse.json()) as {
      id: string;
      status: string;
      recruiterArtifact?: { recommendationBand?: string };
    };
    expect(candidate.id).toBe(candidateId);
    expect(candidate.recruiterArtifact).toBeTruthy();

    const createInterviewResponse = await callWorker(
      new Request("http://example.com/api/interviews", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ interviewId, jobId, candidateId })
      })
    );
    expect(createInterviewResponse.status).toBe(201);

    const listInterviewsResponse = await callWorker(
      new Request("http://example.com/api/interviews")
    );
    expect(listInterviewsResponse.status).toBe(200);
    const interviews = (await listInterviewsResponse.json()) as Array<{
      id: string;
    }>;
    expect(interviews.some((interview) => interview.id === interviewId)).toBe(
      true
    );

    const decisionResponse = await callWorker(
      new Request(`http://example.com/api/interviews/${interviewId}/decision`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          decision: "hire",
          decidedBy: "hm-1",
          notes: "Great panel outcome."
        })
      })
    );
    expect(decisionResponse.status).toBe(200);

    const interviewResponse = await callWorker(
      new Request(`http://example.com/api/interviews/${interviewId}`)
    );
    expect(interviewResponse.status).toBe(200);
    const interview = (await interviewResponse.json()) as {
      id: string;
      status: string;
      phase: string;
      decision?: string;
    };
    expect(interview.id).toBe(interviewId);
    expect(interview.status).toBe("completed");
    expect(interview.phase).toBe("completed");
    expect(interview.decision).toBe("hire");
  });
});
