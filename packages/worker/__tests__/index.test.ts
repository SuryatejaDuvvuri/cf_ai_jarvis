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
});
