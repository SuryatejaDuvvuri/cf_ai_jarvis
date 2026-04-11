import { routeAgentRequest } from "agents";
import { Chat } from "@panelai/agents";

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      return Response.json({
        success: true
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

    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;

// Export the Chat Durable Object class for wrangler to bind
export { Chat };
