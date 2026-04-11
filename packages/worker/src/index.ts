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

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Cloudflare.Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/api/provider/status") {
      const provider = env.AI_PROVIDER ?? "workers-ai";
      const configured =
        provider === "openai-compatible"
          ? Boolean(env.AI_API_KEY && env.AI_BASE_URL)
          : true;
      return Response.json({
        success: configured,
        provider,
        model:
          env.AI_MODEL ??
          (provider === "workers-ai"
            ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
            : "gpt-4o-mini")
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
        const { text, voice } = (await request.json()) as { text?: string; voice?: string };
        if (!text) {
          return Response.json({ error: "No text provided" }, { status: 400 });
        }

        const cleanText = text.replace(/\[MEMORY:[^\]]+\]/g, "").trim();

        // Allowlist of valid Deepgram Aura speakers — one per panel agent
        const allowedSpeakers = new Set([
          "arcas", "asteria", "luna", "stella", "orion", "helios",
          "orus", "perseus", "angus", "orpheus", "amalthea", "athena", "hera"
        ]);
        const speaker = voice && allowedSpeakers.has(voice) ? voice : "arcas";

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
      const orchestrator = env.ORCHESTRATOR.get(
        env.ORCHESTRATOR.idFromName("agent-orchestrator")
      );
      return orchestrator.fetch("https://agent/delegate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          taskId: crypto.randomUUID(),
          type: "run-panel-interview",
          payload,
          from: { id: "worker", name: "Worker", role: "orchestrator" }
        })
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

    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
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
