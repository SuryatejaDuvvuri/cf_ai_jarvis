import type { Schedule } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createOpenAI } from "@ai-sdk/openai";
import { createWorkersAI } from "workers-ai-provider";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type UIMessage,
  type ToolSet
} from "ai";
import { processToolCalls, cleanupMessages } from "@panelai/shared";
import { tools, executions } from "./jarvis.tools.js";

interface JarvisEnv extends Cloudflare.Env {
  AI: Ai;
  AI_PROVIDER?: "workers-ai" | "openai-compatible";
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
}

interface Memory {
  id: number;
  key: string;
  value: string;
  createdAt: string;
}

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<JarvisEnv> {
  private resolveModel() {
    const provider = this.env.AI_PROVIDER ?? "workers-ai";
    const modelName =
      this.env.AI_MODEL ?? "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

    if (provider === "openai-compatible") {
      const apiKey = this.env.AI_API_KEY;
      const baseURL = this.env.AI_BASE_URL;
      if (!apiKey || !baseURL) {
        throw new Error(
          "AI_PROVIDER=openai-compatible requires AI_API_KEY and AI_BASE_URL."
        );
      }
      const openai = createOpenAI({ apiKey, baseURL });
      return openai(modelName);
    }

    const workersAI = createWorkersAI({ binding: this.env.AI });
    return workersAI(modelName as unknown as Parameters<typeof workersAI>[0]);
  }

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
    const model = this.resolveModel();

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
    const allTools: ToolSet = {
      ...tools,
      ...(mcpTools as ToolSet)
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);
        const toolPatterns: RegExp[] = [];
        const lastUserMsg = cleanedMessages
          .filter((message: UIMessage) => message.role === "user")
          .pop();
        const lastTextPart = lastUserMsg?.parts?.find(
          (part) => part.type === "text"
        );
        const lastText =
          lastTextPart && "text" in lastTextPart
            ? lastTextPart.text.toLowerCase()
            : "";
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
          system: `You are PanelAI interview simulation backend.

Role constraints:
- You are NOT a personal assistant.
- Do NOT provide reminders, weather, scheduling, or productivity help.
- Keep all responses strictly within hiring interview simulation context.
- You represent a panel of agents: orchestrator (moderator), recruiter, technical, culture, and domain expert.

Behavior rules:
- Ask concise interview questions and short follow-ups.
- If user asks unrelated assistant requests, redirect back to interview context.
- Keep tone professional and neutral.
- Do not use any tools.

Output style:
- 1-3 short paragraphs max.
- If asking a question, ask one clear question at a time.

Context:
${memoryContext}
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
              const executionHandlers = executions;
              if (toolName in executionHandlers) {
                const handler =
                  executionHandlers[toolName as keyof typeof executionHandlers];
                const toolResult = await handler(
                  toolParams as Parameters<typeof handler>[0]
                );
                console.log(`Tool ${toolName} result:`, toolResult);
                text = text.replace(toolMatch[0], String(toolResult));
              }
              // Check tools with execute functions
              else if (toolName in allTools) {
                const toolDef = allTools[toolName as keyof ToolSet];
                if (toolDef && "execute" in toolDef && toolDef.execute) {
                  try {
                    const toolResult = await toolDef.execute(
                      toolParams as never,
                      {
                        messages:
                          await convertToModelMessages(processedMessages),
                        toolCallId: generateId()
                      }
                    );
                    console.log(`Tool ${toolName} result:`, toolResult);
                    text = text.replace(toolMatch[0], String(toolResult));
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
