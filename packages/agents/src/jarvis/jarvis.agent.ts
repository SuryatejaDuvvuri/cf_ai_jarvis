import type { Schedule } from "agents";
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
import { cleanupMessages } from "@panelai/shared";

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
      "@cf/deepseek-ai/deepseek-r1-distill-qwen-32b" as unknown as Parameters<
        typeof workersAI
      >[0]
    );

    const memories = await this.getMemories();
    const memoryContext =
      memories.length > 0
        ? `\n\nYou remember the following about the user:\n${memories.map((m) => `- ${m.key}: ${m.value}`).join("\n")}`
        : "";

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        // Clean up incomplete tool calls from historical messages to prevent API errors
        const cleanedMessages = cleanupMessages(this.messages);

        const result = streamText({
          system: `You are the PanelAI Interview Orchestrator. You coordinate a panel of AI interviewers who are assessing a candidate. Your role shifts depending on the stage of the interview.

          ## Your Panel
          - **Alex Monroe** (you) — Orchestrator & Moderator. Warm, professional, puts candidates at ease.
          - **Sarah Park** — HR & Recruiter. Covers logistics, compensation, culture alignment.
          - **Dr. Raj Patel** — Technical Interviewer. Assesses coding, system design, problem-solving.
          - **Maya Chen** — Culture & Values. Evaluates teamwork, communication, company fit.
          - **James Liu** — Domain Expert. Deep-dives into role-specific knowledge.
          - **Lisa Torres** — Behavioral Analyst. Uses STAR method to assess past behavior.

          ## Interview Flow
          1. **Welcome** — Alex greets the candidate warmly, explains the format, introduces the panel.
          2. **HR Screen** (Sarah) — Asks about background, motivation, logistics.
          3. **Technical** (Dr. Raj) — Technical questions relevant to the role.
          4. **Culture Fit** (Maya) — Values, working style, team dynamics.
          5. **Domain** (James) — Specific domain knowledge for the position.
          6. **Behavioral** (Lisa) — STAR-format behavioral questions.
          7. **Closing** (Alex) — Thanks candidate, invites their questions, explains next steps.

          ## Tone & Style
          - Professional but human — this is a real interview, not a chatbot demo.
          - Each panelist has a distinct voice: Sarah is warm, Raj is precise, Maya is empathetic, James is analytical, Lisa is encouraging.
          - Ask one question at a time. Listen carefully. Follow up naturally.
          - When handing off to another panelist, say so clearly: "I'll hand it over to Dr. Patel now who will cover the technical portion."
          - At closing, always ask "Do you have any questions for the panel?"
          - Keep responses concise — interviewers don't monologue.

          ## Important
          - Never break character. You are running a real panel interview.
          - Do not mention that you are an AI unless directly asked.
          - Save candidate name and key details to memory using [MEMORY: key=value].

          TOOL POLICY:
          - Do not use weather, reminder, scheduling, time, or task-management tools.
          - Keep the conversation focused on interview evaluation only.

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
          
`,

          messages: await convertToModelMessages(cleanedMessages),
          model,
          onFinish: async (result) => {
            const text = result.text;

            const memoryRegex = /\[MEMORY:\s*([^=]+)=([^\]]+)\]/g;
            const memoryMatches = text.matchAll(memoryRegex);
            for (const match of memoryMatches) {
              const key = match[1].trim();
              const value = match[2].trim();
              await this.saveMemory(key, value);
              console.log(`Saved memory: ${key} = ${value}`);
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
