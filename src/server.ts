import { routeAgentRequest, type Schedule } from "agents";
import { getSchedulePrompt } from "agents/schedule";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { openai } from "@ai-sdk/openai";
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
// import { env } from "cloudflare:workers";

// const model = openai("gpt-4o-2024-11-20");
// Cloudflare AI Gateway
// const openai = createOpenAI({
//   apiKey: env.OPENAI_API_KEY,
//   baseURL: env.GATEWAY_BASE_URL,
// });

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  /**
   * Handles incoming chat messages and manages the response stream
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    
    const workersAI = createWorkersAI({binding: this.env.AI});
    const model =  workersAI("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any);
    // const mcpConnection = await this.mcp.connect(
    //   "https://path-to-mcp-server/sse"
    // );

    let mcpTools = {}
    try
    {
      mcpTools = this.mcp.getAITools();
    }
    catch(e)
    {

    }

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...mcpTools
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        // Process any pending tool calls from previous messages
        // This handles human-in-the-loop confirmations for tools
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: allTools,
          executions
        });

        const result = streamText({
          system: `You are Jarvis, a personal AI assistant. You are helpful, conversational with a good sense of humor and efficient. You don't waste words.
          
          Your personality:
            - You address the user as "sir" or by their name once you know it
            - Warm, American butler vibes, but modern and professional who's also a friend
            - Direct and useful, not sycophantic
            - You're genuinely interested in helping, not just completing tasks
            - You remember context and build on previous conversations
            - You refer to the user by name once you know it

          Greeting style examples:
            - "Good evening, sir. What shall we tackle today?"
            - "Welcome back, sir. What's on the agenda?"
            - "Hello, sir. Ready to get to work?"
            - After learning their name: "Good to see you {name} What do we have today?"

          You have access to these capabilities:
          - Task scheduling and reminders
          - General knowledge and conversation
          - Weather information (requires confirmation)
          

          IMPORTANT: Only use tools when the user explicitly asks for something that requires them.
          - By default, just respond conversationally. 
          - Keep responses personable and concise unless the user asks for detail.
          - You're not just an assistant: you're a capable companion who happens to be incredibly helpful.
          - If the user asks to schedule a task, use the schedule tool to schedule the task.
          - If the user asks about the weather, use the getWeatherInformation tool.

${getSchedulePrompt({ date: new Date() })}
`,

          messages: await convertToModelMessages(processedMessages),
          model,
          // tools: allTools,
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          onFinish: onFinish as unknown as StreamTextOnFinishCallback<
            typeof allTools
          >,
          stopWhen: stepCountIs(10),
          abortSignal: options?.abortSignal
        });

        writer.merge(result.toUIMessageStream());
      }
    });

    return createUIMessageStreamResponse({ stream });
  }
  async executeTask(description: string, _task: Schedule<string>) {
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    if (url.pathname === "/check-open-ai-key") {
      // const hasOpenAIKey = !!process.env.OPENAI_API_KEY;
      return Response.json({
        success: true
      });
    }

    if(url.pathname === "/transcribe" && request.method === "POST")
    {
      try 
      {
        const formData = await request.formData();
        const audioFile = formData.get("audio") as File;

        if(!audioFile)
        {
          return Response.json({error: "No file provided."}, {status:400});
        }

        const buffer = await audioFile.arrayBuffer();
        const result = await env.AI.run("@cf/openai/whisper", {
          audio: [...new Uint8Array(buffer)],
        });

        return Response.json({text: result.text});
      }
      catch(error)
      {
        console.error("Transcription error: ", error);
        return Response.json({error: "Transcription failed"}, {status: 400});
      }
    }

    if(url.pathname === "/speak" && request.method === "POST")
    {
      try
      {
        const {text} = await request.json() as {text?:string};
        if(!text)
        {
          return Response.json({error: "No text provided"},{status:400});
        }

        const audio = await env.AI.run("@cf/myshell-ai/melotts", {
          text: text
        })
      }
      catch(error)
      {

      }
    }
    // if (!process.env.OPENAI_API_KEY) {
    //   console.error(
    //     "OPENAI_API_KEY is not set, don't forget to set it locally in .dev.vars, and use `wrangler secret bulk .dev.vars` to upload it to production"
    //   );
    // }
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
