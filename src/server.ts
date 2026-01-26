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

interface Memory
{
  id:number;
  key:string;
  value:string;
  createdAt:string;
}

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {

  private async initMemory()
  {
    this.sql`
      CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  async saveMemory(key:string,value:string)
  {
    await this.initMemory();
    this.sql`
      INSERT OR REPLACE INTO memories (key,value,created_at)
      VALUES (${key},${value},CURRENT_TIMESTAMP)
    `;
  }
  async getMemories():Promise<Memory[]>
  {
    await this.initMemory();
    return this.sql<Memory>`SELECT * FROM memories ORDER BY created_at DESC`;
  }

  async deleteMemories(key:string)
  {
    await this.initMemory();
    this.sql`DELETE FROM memories WHERE key = ${key}`;
  }
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

    const memories = await this.getMemories()
    const memoryContext = memories.length > 0 ?
     `\n\nYou remember the following about the user:\n${memories.map(m => `- ${m.key}: ${m.value}`).join('\n')}`
     : '';

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

    const agent = this;

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

          CRITICAL INSTRUCTION - READ THIS FIRST:
          Before responding, ask yourself: "Did the user EXPLICITLY ask me to do something that requires a tool?"

          Examples of when NOT to use tools:
          - "Hello" → Just say hello back. NO TOOLS.
          - "Hi Jarvis" → Greet them warmly. NO TOOLS.
          - "How are you?" → Reply conversationally. NO TOOLS.
          - "What can you do?" → Explain your capabilities. NO TOOLS.
          - "Thanks" → You're welcome. NO TOOLS.

          Examples of when TO use tools:
          - "Remind me to call mom in 5 minutes" → Use scheduleTask
          - "What's the weather in Tokyo?" → Use getWeatherInformation  
          - "What time is it in London?" → Use getLocalTime
          - "Show my reminders" → Use getScheduledTasks
          - "Cancel that reminder" → Use cancelScheduledTask

          If the answer is NO, just respond conversationally. DO NOT use any tools.
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
            - After learning their name: "Good to see you [name]. What do we have today?"

          You have access to these capabilities:
          - Task scheduling and reminders
          - General knowledge and conversation
          - Weather information (requires confirmation)

          ${memoryContext}

          MEMORY INSTRUCTIONS:
          When the user tells you personal information (their name, preferences, job, interests, etc.), you should remember it.
          To save a memory, include this EXACT format somewhere in your response:
          [MEMORY: key=value]

          Examples:
          - User says "My name is John" → Include [MEMORY: name=John] in your response
          - User says "I work at Google" → Include [MEMORY: job=Works at Google]
          - User says "I prefer morning meetings" → Include [MEMORY: preference=Prefers morning meetings]
          - User says "I'm working on a React project" → Include [MEMORY: current_project=React project]

          Only save important, persistent facts. Don't save temporary things like "user said hello".

          TOOL USAGE RULES - VERY IMPORTANT:
          - You have access to tools, but you must be VERY selective about using them.

         ONLY use tools when the user EXPLICITLY requests:
          - scheduleTask: ONLY when user says "remind me", "schedule", "set a reminder", "in X minutes/hours"
          - getWeatherInformation: ONLY when user asks "what's the weather", "how's the weather"
          - getLocalTime: ONLY when user asks "what time is it in [location]"
          - getScheduledTasks: ONLY when user asks "what are my tasks", "show my reminders"
          - cancelScheduledTask: ONLY when user asks to "cancel" a specific task

          If in doubt, DO NOT use a tool. Just respond conversationally.

${getSchedulePrompt({ date: new Date() })}
`,

          messages: await convertToModelMessages(processedMessages),
          model,
          // tools: allTools,
          toolChoice:"auto",
          // Type boundary: streamText expects specific tool types, but base class uses ToolSet
          // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
          // onFinish: onFinish as unknown as StreamTextOnFinishCallback<
          //   typeof allTools
          // >,
          onFinish: async(result) => {
            const text = result.text;
            const memoryRegex = /\[MEMORY:\s*([^=]+)=([^\]]+)\]/g;
            let match;

            while ((match = memoryRegex.exec(text)) !== null) 
            {
              const key = match[1].trim();
              const value = match[2].trim();
              await agent.saveMemory(key, value);
              console.log(`Saved memory: ${key} = ${value}`);
            }

            (onFinish as any)(result);
          },
          // stopWhen: stepCountIs(10),
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

        const cleanText = text.replace(/\[MEMORY:[^\]]+\]/g, '').trim();

        const result = await env.AI.run("@cf/deepgram/aura-1", {
          text: cleanText,
          speaker:"arcas",
        }, {returnRawResponse:true});

        // return Response.json({audio:result.audio});
        return result;

      }
      catch(error)
      {
        console.error("TTS error: ", error);
        return Response.json({error: "Speech syntehsis failed"}, {status: 500});
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
