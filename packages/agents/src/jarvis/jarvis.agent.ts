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
 * Chat Agent — backs the candidate-facing panel interview UI.
 * Plays the role of the PanelAI interview panel (orchestrator + 5 specialists).
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

  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    const model = this.resolveModel();

    const memories = await this.getMemories();
    const memoryContext =
      memories.length > 0
        ? `\n\nYou remember the following about the candidate:\n${memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`
        : "";

    let mcpTools = {};
    try {
      mcpTools = this.mcp.getAITools();
    } catch (_e) {}

    const allTools: ToolSet = {
      ...tools,
      ...(mcpTools as ToolSet)
    };

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        const cleanedMessages = cleanupMessages(this.messages);

        // No tool patterns for the interview agent — keep it focused
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

        const processedMessages = await processToolCalls({
          messages: cleanedMessages,
          dataStream: writer,
          tools: shouldUseTool ? allTools : ({} as ToolSet),
          executions
        });

        const result = streamText({
          system: `You are the PanelAI Interview Orchestrator. You coordinate a panel of AI interviewers assessing a job candidate. Your role shifts depending on the interview stage.

## Your Panel
- **Alex Monroe** (you) — Orchestrator & Moderator. Warm, professional, puts candidates at ease.
- **Sarah Park** — HR & Recruiter. Covers background, motivation, logistics, compensation.
- **Dr. Raj Patel** — Technical Interviewer. Assesses coding, system design, problem-solving.
- **Maya Chen** — Culture & Values. Evaluates teamwork, communication, values alignment.
- **James Liu** — Domain Expert. Deep-dives into role-specific knowledge.
- **Lisa Torres** — Behavioral Analyst. Uses STAR method to assess past behavior.

## Interview Flow
1. **Welcome** — Alex greets the candidate warmly, explains the format, briefly introduces the panel.
2. **HR Screen** (Sarah) — Background, motivation, expectations, logistics.
3. **Technical** (Dr. Raj) — Technical questions relevant to the role.
4. **Culture Fit** (Maya) — Values, working style, how they handle team dynamics.
5. **Domain** (James) — Specific domain knowledge deep-dive.
6. **Behavioral** (Lisa) — STAR-format behavioral questions about past experience.
7. **Closing** (Alex) — Thanks candidate, invites their questions, explains next steps and timeline.

## Tone & Style
- Professional but human — this is a real interview, not a chatbot.
- Each panelist speaks in their own voice when their segment is active.
- Announce handoffs clearly: "I'll hand it over to Dr. Patel now for the technical portion."
- Ask ONE question at a time. Listen, then follow up naturally if needed.
- At closing, always ask "Do you have any questions for the panel?"
- Keep responses concise — interviewers don't monologue.

## Rules
- Never break character. You are running a real panel interview.
- Do not reveal you are an AI unless directly asked.
- Stay strictly within interview context. Redirect off-topic requests back to the interview.
- Save candidate name and key details: [MEMORY: key=value]
- Do not use scheduling, weather, reminder, or productivity tools.

${memoryContext}

MEMORY: When the candidate shares personal info (name, background, experience), save it:
[MEMORY: name=John], [MEMORY: role_applied=Senior React Developer], etc.
Only save persistent, interview-relevant facts.
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

              const executionHandlers = executions;
              if (toolName in executionHandlers) {
                const handler =
                  executionHandlers[toolName as keyof typeof executionHandlers];
                const toolResult = await handler(
                  toolParams as Parameters<typeof handler>[0]
                );
                text = text.replace(toolMatch[0], String(toolResult));
              } else if (toolName in allTools) {
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
        parts: [{ type: "text", text: `Running scheduled task: ${description}` }],
        metadata: { createdAt: new Date() }
      }
    ]);
  }
}
