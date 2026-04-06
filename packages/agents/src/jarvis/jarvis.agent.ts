import type { Schedule } from "agents";
import { getSchedulePrompt } from "agents/schedule";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
import { processToolCalls, cleanupMessages } from "@panelai/shared";
import { tools, executions } from "./jarvis.tools.js";

interface Memory {
  id: number;
  key: string;
  value: string;
  createdAt: string;
}

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  private async initMemory() {
    this.sql`
      CREATE TABLE IF NOT EXISTS memories (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      key TEXT NOT NULL UNIQUE,
      value TEXT NOT NULL,
      created_at TEXT DEFAULT CURRENT_TIMESTAMP
      )
    `;
  }

  async saveMemory(key: string, value: string) {
    await this.initMemory();
    this.sql`
      INSERT OR REPLACE INTO memories (key,value,created_at)
      VALUES (${key},${value},CURRENT_TIMESTAMP)
    `;
  }
  async getMemories(): Promise<Memory[]> {
    await this.initMemory();
    return this.sql<Memory>`SELECT * FROM memories ORDER BY created_at DESC`;
  }

  async deleteMemories(key: string) {
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
    const workersAI = createWorkersAI({ binding: this.env.AI });
    const model = workersAI(
      "@cf/meta/llama-3.3-70b-instruct-fp8-fast" as unknown as Parameters<
        typeof workersAI
      >[0]
    );

    const memories = await this.getMemories();
    const memoryContext =
      memories.length > 0
        ? `\n\nYou remember the following about the user:\n${memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`
        : "";

    let mcpTools = {};
    try {
      mcpTools = this.mcp.getAITools();
    } catch (_e) {}

    // Collect all tools, including MCP tools
    const allTools = {
      ...tools,
      ...mcpTools
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);
        const toolPatterns = [
          /what'?s the weather/,
          /how'?s the weather/,
          /weather in \w+/,
          /remind me .+ in \d+/,
          /set a reminder/,
          /schedule .+/,
          /what time is it in/,
          /show my (tasks|reminders)/,
          /what are my (tasks|reminders)/,
          /cancel .*(task|reminder)/
        ];
        const lastUserMsg = cleanedMessages
          .filter((m: any) => m.role === "user")
          .pop();
        const lastText =
          (
            lastUserMsg?.parts?.find((p: any) => p.type === "text") as any
          )?.text?.toLowerCase() || "";
        const shouldUseTool = toolPatterns.some((pattern) =>
          pattern.test(lastText)
        );

        // Process any pending tool calls from previous messages
        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: shouldUseTool ? allTools : ({} as ToolSet),
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
          tools: shouldUseTool ? allTools : undefined,
          toolChoice: shouldUseTool ? "auto" : undefined,
          onFinish: async (result) => {
            let text = result.text;

            const memoryRegex = /\[MEMORY:\s*([^=]+)=([^\]]+)\]/g;
            const memoryMatches = text.matchAll(memoryRegex);
            for (const match of memoryMatches) {
              const key = match[1].trim();
              const value = match[2].trim();
              await this.saveMemory(key, value);
              console.log(`Saved memory: ${key} = ${value}`);
            }

            // Handle raw JSON tool calls that Llama 3 outputs as text
            const toolCallRegex =
              /\{"type":\s*"function",\s*"name":\s*"(\w+)",\s*"parameters":\s*(\{[^}]*\})\}/;
            const toolMatch = text.match(toolCallRegex);
            if (toolMatch) {
              const toolName = toolMatch[1];
              const toolParams = JSON.parse(toolMatch[2]);
              console.log(`Detected raw tool call: ${toolName}`, toolParams);

              // Check executions first (confirmation-required tools)
              if (toolName in executions) {
                const toolResult = await (executions as any)[toolName](
                  toolParams
                );
                console.log(`Tool ${toolName} result:`, toolResult);
                text = text.replace(toolMatch[0], toolResult);
              }
              // Check tools with execute functions
              else if (toolName in tools) {
                const toolDef = (tools as any)[toolName];
                if (toolDef.execute) {
                  try {
                    const toolResult = await toolDef.execute(toolParams);
                    console.log(`Tool ${toolName} result:`, toolResult);
                    text = text.replace(toolMatch[0], toolResult);
                  } catch (err) {
                    console.error(`Tool ${toolName} error:`, err);
                    text = text.replace(
                      toolMatch[0],
                      `Sorry, I couldn't complete that action.`
                    );
                  }
                }
              }
            }

            // biome-ignore lint/suspicious/noExplicitAny: Type mismatch with SDK callback
            (onFinish as any)(result);
          },
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
