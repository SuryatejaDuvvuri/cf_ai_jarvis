import type { Schedule } from "agents";
import { AIChatAgent } from "@cloudflare/ai-chat";
import { createWorkersAI } from "workers-ai-provider";
import { createOpenAI } from "@ai-sdk/openai";
import {
  generateId,
  generateText,
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
  AI_PROVIDER?: "workers-ai" | "openai-compatible" | "groq";
  AI_MODEL?: string;
  AI_BASE_URL?: string;
  AI_API_KEY?: string;
}

type PanelSpeakerId =
  | "orchestrator"
  | "hr"
  | "technical"
  | "culture"
  | "domain"
  | "behavioral";

type SpecialistSpeakerId = Exclude<PanelSpeakerId, "orchestrator">;

interface PanelRoute {
  mode: "welcome" | "interview" | "closing";
  primary: PanelSpeakerId;
  coordinated: SpecialistSpeakerId[];
  reason: string;
}

interface SimpleTurnMessage {
  role: "user" | "assistant";
  content: string;
}

/** Map speaker ID → DO binding name in the environment */
const SPEAKER_BINDING: Partial<Record<PanelSpeakerId, string>> = {
  hr: "RECRUITER",
  technical: "TECHNICAL_INTERVIEWER",
  culture: "CULTURE_INTERVIEWER",
  domain: "DOMAIN_EXPERT"
};

const PANEL_SPEAKERS: Record<PanelSpeakerId, { name: string }> = {
  orchestrator: { name: "Alex Monroe" },
  hr: { name: "Sarah Park" },
  technical: { name: "Dr. Raj Patel" },
  culture: { name: "Maya Chen" },
  domain: { name: "James Liu" },
  behavioral: { name: "Lisa Torres" }
};

const REQUIRED_SPECIALISTS: SpecialistSpeakerId[] = [
  "hr",
  "technical",
  "culture",
  "domain",
  "behavioral"
];

const MAX_COORDINATED_SPECIALISTS = 2;
const SOFT_CLOSE_SPECIALIST_TURN_THRESHOLD = 7;
const HARD_CLOSE_SPECIALIST_TURN_THRESHOLD = 10;
const INTERNAL_KEY_PREFIX = "__internal:";
const QUEUED_PANEL_FOLLOW_UP_KEY = `${INTERNAL_KEY_PREFIX}queued_panel_follow_up`;

const SPEAKER_PATTERNS: Array<{ id: PanelSpeakerId; pattern: RegExp }> = [
  {
    id: "orchestrator",
    pattern: /\balex monroe\b|\balex\b|\bmoderator\b|\borchestrator\b/
  },
  { id: "hr", pattern: /\bsarah park\b|\bsarah\b/ },
  {
    id: "technical",
    pattern: /\bdr\.?\s*raj patel\b|\braj patel\b|\bdr\.?\s*raj\b|\braj\b/
  },
  { id: "culture", pattern: /\bmaya chen\b|\bmaya\b/ },
  { id: "domain", pattern: /\bjames liu\b|\bjames\b/ },
  { id: "behavioral", pattern: /\blisa torres\b|\blisa\b/ }
];

const SPEAKER_TURN_PREFIX_PATTERNS: Array<{
  id: PanelSpeakerId;
  pattern: RegExp;
}> = [
  {
    id: "orchestrator",
    pattern: /^(?:alex monroe|alex|moderator|orchestrator)\s*[:-]\s*/i
  },
  { id: "hr", pattern: /^(?:sarah park|sarah)\s*[:-]\s*/i },
  {
    id: "technical",
    pattern: /^(?:dr\.?\s*raj patel|raj patel|dr\.?\s*raj|raj)\s*[:-]\s*/i
  },
  { id: "culture", pattern: /^(?:maya chen|maya)\s*[:-]\s*/i },
  { id: "domain", pattern: /^(?:james liu|james)\s*[:-]\s*/i },
  { id: "behavioral", pattern: /^(?:lisa torres|lisa)\s*[:-]\s*/i }
];

const SPEAKER_SELF_INTRO_PATTERNS: Array<{
  id: PanelSpeakerId;
  pattern: RegExp;
}> = [
  {
    id: "orchestrator",
    pattern:
      /^(?:hi|hello|thanks|thank you)?[\s,]*(?:i[' ]?m|i am|this is)\s+(?:alex monroe|alex)\b/i
  },
  {
    id: "hr",
    pattern:
      /^(?:hi|hello|thanks|thank you)?[\s,]*(?:i[' ]?m|i am|this is)\s+(?:sarah park|sarah)\b/i
  },
  {
    id: "technical",
    pattern:
      /^(?:hi|hello|thanks|thank you)?[\s,]*(?:i[' ]?m|i am|this is)\s+(?:dr\.?\s*raj patel|raj patel|dr\.?\s*raj|raj)\b/i
  },
  {
    id: "culture",
    pattern:
      /^(?:hi|hello|thanks|thank you)?[\s,]*(?:i[' ]?m|i am|this is)\s+(?:maya chen|maya)\b/i
  },
  {
    id: "domain",
    pattern:
      /^(?:hi|hello|thanks|thank you)?[\s,]*(?:i[' ]?m|i am|this is)\s+(?:james liu|james)\b/i
  },
  {
    id: "behavioral",
    pattern:
      /^(?:hi|hello|thanks|thank you)?[\s,]*(?:i[' ]?m|i am|this is)\s+(?:lisa torres|lisa)\b/i
  }
];

const TOPIC_KEYWORDS: Record<SpecialistSpeakerId, string[]> = {
  hr: [
    "salary",
    "compensation",
    "notice",
    "visa",
    "sponsorship",
    "start date",
    "relocation",
    "motivation",
    "why this role",
    "availability"
  ],
  technical: [
    "code",
    "coding",
    "algorithm",
    "complexity",
    "debug",
    "bug",
    "api",
    "architecture",
    "system design",
    "performance",
    "database",
    "react",
    "typescript"
  ],
  culture: [
    "team",
    "collabor",
    "conflict",
    "feedback",
    "communication",
    "culture",
    "values",
    "leadership",
    "stakeholder"
  ],
  domain: [
    "domain",
    "industry",
    "product",
    "customer",
    "business",
    "compliance",
    "healthcare",
    "finance",
    "fintech",
    "platform"
  ],
  behavioral: [
    "example",
    "situation",
    "challenge",
    "mistake",
    "failure",
    "impact",
    "result",
    "learned",
    "difficult"
  ]
};

function getMessageText(message: UIMessage): string {
  return (message.parts ?? [])
    .filter(
      (part): part is Extract<typeof part, { type: "text" }> =>
        part.type === "text"
    )
    .map((part) => part.text)
    .join("\n")
    .trim();
}

function detectSpeakerMentions(text: string): PanelSpeakerId[] {
  const lower = text.toLowerCase();
  const hits: Array<{ id: PanelSpeakerId; index: number }> = [];

  for (const entry of SPEAKER_PATTERNS) {
    const idx = lower.search(entry.pattern);
    if (idx >= 0) {
      hits.push({ id: entry.id, index: idx });
    }
  }

  hits.sort((a, b) => a.index - b.index);
  return [...new Set(hits.map((hit) => hit.id))];
}

function detectSpeakerTurns(text: string): PanelSpeakerId[] {
  const lines = text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

  const detected = new Set<PanelSpeakerId>();

  for (const line of lines) {
    for (const entry of SPEAKER_TURN_PREFIX_PATTERNS) {
      if (entry.pattern.test(line)) {
        detected.add(entry.id);
        break;
      }
    }
  }

  if (detected.size > 0) {
    return [...detected];
  }

  const opener = lines[0] ?? text.trim();
  for (const entry of SPEAKER_SELF_INTRO_PATTERNS) {
    if (entry.pattern.test(opener)) {
      return [entry.id];
    }
  }

  return [];
}

function scoreKeywords(text: string, keywords: string[]): number {
  return keywords.reduce(
    (acc, keyword) => (text.includes(keyword) ? acc + 1 : acc),
    0
  );
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

interface Memory {
  id: number;
  key: string;
  value: string;
  createdAt: string;
}

interface QueuedPanelFollowUp {
  speakerId: SpecialistSpeakerId;
  text: string;
  createdAt: string;
}

/**
 * Chat Agent — backs the candidate-facing panel interview UI.
 * Plays the role of the PanelAI interview panel (orchestrator + 5 specialists).
 */
export class Chat extends AIChatAgent<JarvisEnv> {
  private hasSpeakerSpoken(
    messages: UIMessage[],
    speakerId: PanelSpeakerId
  ): boolean {
    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      const speakers = detectSpeakerTurns(getMessageText(message));
      if (speakers.includes(speakerId)) {
        return true;
      }
    }

    return false;
  }

  private getSingleSpeakerFallbackQuestion(speakerId: PanelSpeakerId): string {
    switch (speakerId) {
      case "hr":
        return "What kind of team environment helps you do your best work day to day?";
      case "technical":
        return "Can you walk me through a recent technical decision you made and the tradeoffs you considered?";
      case "culture":
        return "Tell me about a time you adapted your communication style to work effectively with someone very different from you.";
      case "domain":
        return "What domain-specific risk do you watch most closely in projects like this, and how do you mitigate it?";
      case "behavioral":
        return "Can you share a specific example of feedback that changed how you approach your work?";
      default:
        return "Could you expand on that with one concrete example?";
    }
  }

  private looksLikeClosingLanguage(text: string): boolean {
    return /\b(before we conclude|as we conclude|to conclude|wrap up|wrap-up|end this interview|thanks? for your time|panel will deliberate|we(?:'| )?ll deliberate|do you have any questions for the panel|any questions for the panel)\b/i.test(
      text
    );
  }

  private getModeratorClosingPrompt(): string {
    return "Alex Monroe: Thanks for your thoughtful responses today. We'll take a moment to deliberate as a panel. Do you have any questions for the panel?";
  }

  private applyFirstTurnIntroduction(
    speakerId: SpecialistSpeakerId,
    text: string
  ): string {
    const speakerName = PANEL_SPEAKERS[speakerId].name;
    const content = text
      .replace(new RegExp(`^${escapeRegExp(speakerName)}\\s*:\\s*`, "i"), "")
      .trim();

    if (/^(?:thanks|thank you)\s+alex\b/i.test(content)) {
      return `${speakerName}: ${content}`;
    }

    const introBySpeaker: Record<SpecialistSpeakerId, string> = {
      hr: "Thanks Alex. Hi, I'm Sarah, and I'll assess role fit, motivation, and logistics.",
      technical:
        "Thanks Alex. Hi, I'm Dr. Raj, and I'll assess your technical depth and problem-solving approach.",
      culture:
        "Thanks Alex. Hi, I'm Maya, and I'll assess collaboration, communication, and values alignment.",
      domain:
        "Thanks Alex. Hi, I'm James, and I'll assess your domain-specific depth and practical judgment.",
      behavioral:
        "Thanks Alex. Hi, I'm Lisa, and I'll assess behavioral signals using concrete examples."
    };

    return `${speakerName}: ${introBySpeaker[speakerId]} ${content}`.trim();
  }

  private resolveModel() {
    const rawProvider = (this.env.AI_PROVIDER ?? "workers-ai").toLowerCase();
    const isWorkersAI = rawProvider === "workers-ai";

    const modelName =
      this.env.AI_MODEL ??
      (isWorkersAI
        ? "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
        : "llama-3.3-70b-versatile");

    if (isWorkersAI) {
      const workersAI = createWorkersAI({ binding: this.env.AI });
      return workersAI(modelName as unknown as Parameters<typeof workersAI>[0]);
    }

    const apiKey = (this.env.AI_API_KEY ?? "").trim();
    const configuredBaseUrl = (this.env.AI_BASE_URL ?? "").trim();
    const baseURL =
      configuredBaseUrl ||
      (rawProvider === "groq" ? "https://api.groq.com/openai/v1" : "");

    if (!apiKey) {
      throw new Error(
        "AI_API_KEY is required when AI_PROVIDER is not workers-ai."
      );
    }

    if (!baseURL) {
      throw new Error(
        "AI_BASE_URL is required when AI_PROVIDER is openai-compatible."
      );
    }

    const openai = createOpenAI({
      apiKey,
      baseURL,
      name: rawProvider
    });
    return openai.chat(modelName);
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

  async getMemoryValue(key: string): Promise<string | null> {
    await this.initMemory();
    const rows = this.sql<{ value: string }>`
      SELECT value
      FROM memories
      WHERE key = ${key}
      LIMIT 1
    `;
    return rows[0]?.value ?? null;
  }

  private getLatestUserText(messages: UIMessage[]): string {
    const lastUser = [...messages]
      .reverse()
      .find((message) => message.role === "user");
    return lastUser ? getMessageText(lastUser).toLowerCase() : "";
  }

  private toSimpleMessages(messages: UIMessage[]): SimpleTurnMessage[] {
    return messages
      .filter(
        (message) => message.role === "user" || message.role === "assistant"
      )
      .map((message) => ({
        role: message.role as "user" | "assistant",
        content: getMessageText(message)
      }))
      .filter((message) => message.content.length > 0);
  }

  private normalizeSpecialistTurnText(
    speakerId: PanelSpeakerId,
    text: string
  ): string {
    const speakerName = PANEL_SPEAKERS[speakerId].name;
    const trimmed = text.trim();

    if (!trimmed) {
      return `${speakerName}: I will jump in with a focused follow-up question.`;
    }

    const speakerPrefixRegex = new RegExp(
      `^${escapeRegExp(speakerName)}\\s*:\\s*`,
      "i"
    );

    const content = trimmed.replace(speakerPrefixRegex, "").trim();

    const otherSpeakerNames = Object.entries(PANEL_SPEAKERS)
      .filter(([id]) => id !== speakerId)
      .map(([, speaker]) => speaker.name);

    const otherSpeakerMentions = otherSpeakerNames.reduce((count, name) => {
      const regex = new RegExp(`\\b${escapeRegExp(name)}\\b`, "gi");
      return count + (content.match(regex)?.length ?? 0);
    }, 0);

    const speakerIntroRegex = new RegExp(
      `^(?:hi|hello|hey)?[\\s,!.:-]*(?:(?:i[' ]?m|i am|this is)\\s+${escapeRegExp(
        speakerName
      )}|${escapeRegExp(speakerName)}\\s+here)\\b[\\s,!.:-]*`,
      "i"
    );

    const withoutSelfIntro = content.replace(speakerIntroRegex, "").trim();

    const parentheticalSpeakerRegex = new RegExp(
      `\\(\\s*(?:${otherSpeakerNames.map(escapeRegExp).join("|")})\\s*\\)`,
      "gi"
    );
    const inlineSpeakerPrefixRegex = new RegExp(
      `(?:${otherSpeakerNames.map(escapeRegExp).join("|")})\\s*:\\s*`,
      "gi"
    );

    const withoutPanelPersonaTags = withoutSelfIntro
      .replace(parentheticalSpeakerRegex, "")
      .replace(inlineSpeakerPrefixRegex, "")
      .trim();

    const sanitizedContent = withoutPanelPersonaTags
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .filter(
        (line) =>
          !/^\(?\s*(?:the\s+)?candidate\s+(?:responds?|answers?)\b/i.test(line)
      )
      .join(" ")
      .trim();

    if (
      speakerId !== "orchestrator" &&
      this.looksLikeClosingLanguage(sanitizedContent)
    ) {
      return `${speakerName}: ${this.getSingleSpeakerFallbackQuestion(speakerId)}`;
    }

    // Guardrail: if a model tries to simulate multiple panelists, collapse back
    // to one focused question in this speaker's lane.
    if (
      otherSpeakerMentions >= 2 ||
      /\b(?:each\s+panel\s+member|panel\s+members|let\s+each|all\s+of\s+us)\b/i.test(
        content
      )
    ) {
      return `${speakerName}: ${this.getSingleSpeakerFallbackQuestion(speakerId)}`;
    }

    return `${speakerName}: ${
      sanitizedContent ||
      "I have a focused follow-up question from my perspective."
    }`;
  }

  private countSpecialistTurns(messages: UIMessage[]): number {
    let turns = 0;

    for (const message of messages) {
      if (message.role !== "assistant") {
        continue;
      }

      const speakers = detectSpeakerTurns(getMessageText(message));
      const specialistSpeakers = [...new Set(speakers)].filter(
        (speaker): speaker is SpecialistSpeakerId => speaker !== "orchestrator"
      );

      turns += specialistSpeakers.length;
    }

    return turns;
  }

  private shouldBridgeFollowUp(options: {
    primarySpeakerId: SpecialistSpeakerId;
    nextSpeakerId: SpecialistSpeakerId;
    latestUserText: string;
    specialistTurnsSoFar: number;
  }): boolean {
    const {
      primarySpeakerId,
      nextSpeakerId,
      latestUserText,
      specialistTurnsSoFar
    } = options;

    const primaryTopicScore = scoreKeywords(
      latestUserText,
      TOPIC_KEYWORDS[primarySpeakerId]
    );
    const nextTopicScore = scoreKeywords(
      latestUserText,
      TOPIC_KEYWORDS[nextSpeakerId]
    );

    if (primaryTopicScore > 0 && nextTopicScore > 0) {
      return true;
    }

    if (specialistTurnsSoFar < REQUIRED_SPECIALISTS.length) {
      return false;
    }

    // After baseline coverage, alternate between bridge and independent turns.
    return specialistTurnsSoFar % 2 === 0;
  }

  private enforcePeerReference(options: {
    text: string;
    speakerId: PanelSpeakerId;
    previousSpeakerId: PanelSpeakerId;
  }): string {
    const { text, speakerId, previousSpeakerId } = options;
    const currentName = PANEL_SPEAKERS[speakerId].name;
    const previousName = PANEL_SPEAKERS[previousSpeakerId].name;
    const previousFirst = previousName.split(" ")[0].toLowerCase();

    const normalized = this.normalizeSpecialistTurnText(speakerId, text);
    const content = normalized
      .replace(new RegExp(`^${escapeRegExp(currentName)}\\s*:\\s*`, "i"), "")
      .trim();

    const lower = content.toLowerCase();
    const alreadyReferencesPeer =
      lower.includes(previousName.toLowerCase()) ||
      lower.includes(previousFirst) ||
      /\b(building on|following up on|as .*?(mentioned|asked|noted)|to add to)\b/.test(
        lower
      );

    if (alreadyReferencesPeer) {
      return `${currentName}: ${content}`;
    }

    return `${currentName}: Building on ${previousName}'s question, ${content}`;
  }

  private choosePanelRoute(messages: UIMessage[]): PanelRoute {
    const assistantMessages = messages.filter(
      (message) => message.role === "assistant"
    );

    if (assistantMessages.length === 0) {
      return {
        mode: "welcome",
        primary: "orchestrator",
        coordinated: [],
        reason: "first-turn"
      };
    }

    const coverage: Record<PanelSpeakerId, number> = {
      orchestrator: 0,
      hr: 0,
      technical: 0,
      culture: 0,
      domain: 0,
      behavioral: 0
    };

    let lastSpecialist: SpecialistSpeakerId | null = null;
    let specialistTurnsSoFar = 0;

    for (const message of assistantMessages) {
      const speakers = detectSpeakerTurns(getMessageText(message));
      if (speakers.length === 0) {
        continue;
      }

      for (const speaker of speakers) {
        coverage[speaker] += 1;
      }

      const specialistSpeakers = [...new Set(speakers)].filter(
        (speaker): speaker is SpecialistSpeakerId => speaker !== "orchestrator"
      );
      specialistTurnsSoFar += specialistSpeakers.length;

      const trailingSpecialist = [...speakers]
        .reverse()
        .find((speaker) => speaker !== "orchestrator");

      if (trailingSpecialist) {
        lastSpecialist = trailingSpecialist;
      }
    }

    const userText = this.getLatestUserText(messages);
    const allSpecialistsCovered = REQUIRED_SPECIALISTS.every(
      (speaker) => coverage[speaker] > 0
    );

    const closingIntent =
      /\b(that is all|that's all|no more questions|wrap up|next steps|anything else)\b/.test(
        userText
      ) ||
      /\b(i|we)\s+(?:do not|don't)\s+have\s+any\s+questions\b/.test(userText) ||
      /\bdo you have any other questions\b/.test(userText);

    const topicScores: Record<SpecialistSpeakerId, number> = {
      hr: scoreKeywords(userText, TOPIC_KEYWORDS.hr),
      technical: scoreKeywords(userText, TOPIC_KEYWORDS.technical),
      culture: scoreKeywords(userText, TOPIC_KEYWORDS.culture),
      domain: scoreKeywords(userText, TOPIC_KEYWORDS.domain),
      behavioral: scoreKeywords(userText, TOPIC_KEYWORDS.behavioral)
    };

    const pendingSpecialists = REQUIRED_SPECIALISTS.filter(
      (speaker) => coverage[speaker] === 0
    );

    const userMentionedSpecialists = detectSpeakerMentions(userText).filter(
      (speaker): speaker is SpecialistSpeakerId => speaker !== "orchestrator"
    );

    const strongestTopicScore = Math.max(...Object.values(topicScores));
    const hasTargetedFollowUp =
      strongestTopicScore > 0 || userMentionedSpecialists.length > 0;
    const reachedSoftCloseThreshold =
      allSpecialistsCovered &&
      specialistTurnsSoFar >= SOFT_CLOSE_SPECIALIST_TURN_THRESHOLD;
    const reachedHardCloseThreshold =
      specialistTurnsSoFar >= HARD_CLOSE_SPECIALIST_TURN_THRESHOLD;

    if (
      reachedHardCloseThreshold ||
      (allSpecialistsCovered && closingIntent) ||
      (reachedSoftCloseThreshold && !hasTargetedFollowUp)
    ) {
      return {
        mode: "closing",
        primary: "orchestrator",
        coordinated: [],
        reason: reachedHardCloseThreshold
          ? "question-threshold-reached"
          : allSpecialistsCovered && closingIntent
            ? "candidate-ready-to-wrap"
            : "coverage-threshold-reached"
      };
    }

    const routingWeight = (speaker: SpecialistSpeakerId): number => {
      const topicWeight = topicScores[speaker] * 10;
      const mentionWeight = userMentionedSpecialists.includes(speaker) ? 20 : 0;
      const coverageWeight = pendingSpecialists.includes(speaker) ? 5 : 0;
      return topicWeight + mentionWeight + coverageWeight;
    };

    const specialistPool: SpecialistSpeakerId[] = [
      "technical",
      "culture",
      "domain",
      "behavioral",
      "hr"
    ];

    let primary: SpecialistSpeakerId;

    if (pendingSpecialists.length > 0) {
      primary = pendingSpecialists.reduce((best, speaker) =>
        routingWeight(speaker) > routingWeight(best) ? speaker : best
      );

      if (
        topicScores[primary] === 0 &&
        lastSpecialist &&
        pendingSpecialists.includes(lastSpecialist)
      ) {
        primary = lastSpecialist;
      }
    } else {
      primary = specialistPool.reduce((best, speaker) =>
        routingWeight(speaker) > routingWeight(best) ? speaker : best
      );

      if (topicScores[primary] === 0 && lastSpecialist) {
        primary = lastSpecialist;
      }
    }

    const coordinated = specialistPool
      .filter((speaker) => speaker !== primary)
      .sort((a, b) => routingWeight(b) - routingWeight(a))
      .filter((speaker) => routingWeight(speaker) > 0)
      .slice(0, Math.max(0, MAX_COORDINATED_SPECIALISTS - 1));

    return {
      mode: "interview",
      primary,
      coordinated,
      reason:
        pendingSpecialists.length > 0
          ? "coverage-and-topic-routing"
          : "topic-driven-follow-up"
    };
  }

  private async callSpecialistTurn(options: {
    speakerId: PanelSpeakerId;
    bindingKey: string;
    simpleMessages: SimpleTurnMessage[];
    candidateContext?: string;
  }): Promise<string> {
    const { speakerId, bindingKey, simpleMessages, candidateContext } = options;

    // biome-ignore lint/suspicious/noExplicitAny: dynamic DO binding access
    const ns = (this.env as unknown as Record<string, unknown>)[bindingKey] as
      | DurableObjectNamespace
      | undefined;

    const speakerName = PANEL_SPEAKERS[speakerId].name;
    const specialistText = `${speakerName}: I will jump in with the next question.`;

    if (!ns) {
      return specialistText;
    }

    try {
      const delegatedContext = [
        candidateContext,
        'Panel moderation rules:\n- Ask exactly one concise question in your specialist lane\n- Never close or conclude the interview\n- Never ask "Do you have any questions for the panel?"\n- Alex Monroe handles all closing and wrap-up prompts\n- Do not simulate other panelists or candidate responses'
      ]
        .filter(
          (value): value is string =>
            typeof value === "string" && value.trim().length > 0
        )
        .join("\n\n");

      const sessionName = `${this.name ?? "session"}-${speakerId}`;
      const stub = ns.get(ns.idFromName(sessionName));
      const response = await stub.fetch("https://agent/turn", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          messages: simpleMessages,
          candidateContext: delegatedContext || undefined
        })
      });

      if (!response.ok) {
        console.error(
          `Specialist DO /turn error ${response.status}: ${await response.text()}`
        );
        return specialistText;
      }

      const data = (await response.json()) as { text?: string; error?: string };
      return data.text ?? specialistText;
    } catch (error) {
      console.error("Specialist DO call failed:", error);
      return specialistText;
    }
  }

  private async callBehavioralTurn(options: {
    simpleMessages: SimpleTurnMessage[];
    candidateContext?: string;
  }): Promise<string> {
    const result = await generateText({
      model: this.resolveModel(),
      system: `You are Lisa Torres, the Behavioral Analyst at PanelAI.

## Persona
- Speak as Lisa Torres, but do not re-introduce yourself after the first turn in this interview
- Calm, clear, and focused on concrete examples
- Use STAR follow-ups when needed

## Rules
- Ask exactly ONE behavioral question
- Keep it concise and specific
- Never close or conclude the interview; Alex Monroe handles wrap-up prompts
- Never ask "Do you have any questions for the panel?"
- Do not reveal you are an AI unless directly asked

${options.candidateContext ?? ""}`,
      messages: options.simpleMessages
    });

    return result.text;
  }

  async getMemories(): Promise<Memory[]> {
    await this.initMemory();
    return this.sql<Memory>`
      SELECT *
      FROM memories
      WHERE key NOT LIKE ${`${INTERNAL_KEY_PREFIX}%`}
      ORDER BY created_at DESC
    `;
  }

  async deleteMemories(key: string) {
    await this.initMemory();
    this.sql`DELETE FROM memories WHERE key = ${key}`;
  }

  private async getQueuedPanelFollowUp(): Promise<QueuedPanelFollowUp | null> {
    const rawValue = await this.getMemoryValue(QUEUED_PANEL_FOLLOW_UP_KEY);
    if (!rawValue) {
      return null;
    }

    try {
      const parsed = JSON.parse(rawValue) as Partial<QueuedPanelFollowUp>;
      if (
        !parsed ||
        typeof parsed.text !== "string" ||
        parsed.text.trim().length === 0 ||
        typeof parsed.speakerId !== "string" ||
        !(parsed.speakerId in PANEL_SPEAKERS)
      ) {
        await this.deleteMemories(QUEUED_PANEL_FOLLOW_UP_KEY);
        return null;
      }

      return {
        speakerId: parsed.speakerId as SpecialistSpeakerId,
        text: parsed.text,
        createdAt:
          typeof parsed.createdAt === "string"
            ? parsed.createdAt
            : new Date().toISOString()
      };
    } catch (_error) {
      await this.deleteMemories(QUEUED_PANEL_FOLLOW_UP_KEY);
      return null;
    }
  }

  private async setQueuedPanelFollowUp(
    followUp: QueuedPanelFollowUp | null
  ): Promise<void> {
    if (!followUp) {
      await this.deleteMemories(QUEUED_PANEL_FOLLOW_UP_KEY);
      return;
    }

    await this.saveMemory(QUEUED_PANEL_FOLLOW_UP_KEY, JSON.stringify(followUp));
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

        const queuedFollowUp = await this.getQueuedPanelFollowUp();
        if (queuedFollowUp) {
          const latestUserText = this.getLatestUserText(cleanedMessages);
          const candidateWantsToWrap =
            /\b(that is all|that's all|no more questions|wrap up|next steps|anything else)\b/.test(
              latestUserText
            ) ||
            /\b(i|we)\s+(?:do not|don't)\s+have\s+any\s+questions\b/.test(
              latestUserText
            ) ||
            /\bdo you have any other questions\b/.test(latestUserText);

          if (!candidateWantsToWrap) {
            await this.setQueuedPanelFollowUp(null);

            const queuedText = this.normalizeSpecialistTurnText(
              queuedFollowUp.speakerId,
              queuedFollowUp.text
            );

            const memoryRegex = /\[MEMORY:\s*([^=]+)=([^\]]+)\]/g;
            for (const match of queuedText.matchAll(memoryRegex)) {
              await this.saveMemory(match[1].trim(), match[2].trim());
            }

            const msgId = generateId();
            const queuedStream = new ReadableStream({
              start(controller) {
                controller.enqueue({ type: "text-start", id: msgId });
                controller.enqueue({
                  type: "text-delta",
                  id: msgId,
                  delta: queuedText
                });
                controller.enqueue({ type: "text-end", id: msgId });
                controller.close();
              }
            });

            writer.merge(queuedStream as ReadableStream);

            // biome-ignore lint/suspicious/noExplicitAny: SDK callback
            (onFinish as any)({
              text: queuedText,
              usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
              finishReason: "stop",
              toolCalls: [],
              toolResults: []
            });

            return;
          }

          await this.setQueuedPanelFollowUp(null);
        }

        const route = this.choosePanelRoute(cleanedMessages);

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

        // ── Specialist DO delegation ─────────────────────────────────────
        // Route turns dynamically to whichever specialist best fits the latest
        // candidate response; optionally run a coordinated dual specialist turn.
        const primaryBindingKey = SPEAKER_BINDING[route.primary];

        if (primaryBindingKey || route.primary === "behavioral") {
          const simpleMessages = this.toSimpleMessages(processedMessages);
          const latestUserText = this.getLatestUserText(processedMessages);
          const specialistTurnsSoFar =
            this.countSpecialistTurns(processedMessages);
          const isPrimaryFirstTurn =
            route.primary !== "orchestrator" &&
            !this.hasSpeakerSpoken(processedMessages, route.primary);

          const primaryText =
            route.primary === "behavioral"
              ? await this.callBehavioralTurn({
                  simpleMessages,
                  candidateContext: memoryContext || undefined
                })
              : await this.callSpecialistTurn({
                  speakerId: route.primary,
                  bindingKey: primaryBindingKey!,
                  simpleMessages,
                  candidateContext: memoryContext || undefined
                });

          const immediateTurnText = this.normalizeSpecialistTurnText(
            route.primary,
            primaryText
          );

          let specialistText =
            isPrimaryFirstTurn && route.primary !== "orchestrator"
              ? this.applyFirstTurnIntroduction(
                  route.primary as SpecialistSpeakerId,
                  immediateTurnText
                )
              : immediateTurnText;

          if (
            route.primary !== "orchestrator" &&
            this.looksLikeClosingLanguage(specialistText)
          ) {
            specialistText = this.getModeratorClosingPrompt();
            await this.setQueuedPanelFollowUp(null);
          }

          const nextCoordinatedSpeaker = route.coordinated[0];
          if (nextCoordinatedSpeaker) {
            const bindingKey = SPEAKER_BINDING[nextCoordinatedSpeaker];
            const primarySpeakerName = PANEL_SPEAKERS[route.primary].name;
            const shouldBridgeFollowUp = this.shouldBridgeFollowUp({
              primarySpeakerId: route.primary as SpecialistSpeakerId,
              nextSpeakerId: nextCoordinatedSpeaker,
              latestUserText,
              specialistTurnsSoFar
            });
            const isQueuedSpeakerFirstTurn = !this.hasSpeakerSpoken(
              processedMessages,
              nextCoordinatedSpeaker
            );

            const coordinatedContext = `${memoryContext}\n\nPanel coordination note: ${primarySpeakerName} asked the previous question. The candidate has not answered that question yet in this turn. Do not invent or narrate a candidate response.\n\nThe following panel turns already happened in this turn:\n${immediateTurnText}\n\nRules for this coordinated follow-up:\n- Ask one concise, non-redundant follow-up question\n- If there is a clear overlap with ${primarySpeakerName}'s question, you may briefly reference it\n- If overlap is weak, ask an independent question from your own lane\n- Do not include placeholder lines like "(The candidate responds...)"\n- Do not re-introduce yourself; continue naturally as an ongoing panel discussion.`;

            const rawQueuedFollowUpText =
              nextCoordinatedSpeaker === "behavioral"
                ? await this.callBehavioralTurn({
                    simpleMessages: [
                      ...simpleMessages,
                      {
                        role: "assistant",
                        content: immediateTurnText
                      }
                    ],
                    candidateContext: coordinatedContext
                  })
                : bindingKey
                  ? await this.callSpecialistTurn({
                      speakerId: nextCoordinatedSpeaker,
                      bindingKey,
                      simpleMessages: [
                        ...simpleMessages,
                        {
                          role: "assistant",
                          content: immediateTurnText
                        }
                      ],
                      candidateContext: coordinatedContext
                    })
                  : `${PANEL_SPEAKERS[nextCoordinatedSpeaker].name}: I have a brief follow-up from my perspective.`;

            const normalizedQueuedFollowUpText =
              this.normalizeSpecialistTurnText(
                nextCoordinatedSpeaker,
                rawQueuedFollowUpText
              );

            const queuedFollowUpText = shouldBridgeFollowUp
              ? this.enforcePeerReference({
                  text: normalizedQueuedFollowUpText,
                  speakerId: nextCoordinatedSpeaker,
                  previousSpeakerId: route.primary
                })
              : normalizedQueuedFollowUpText;

            const finalQueuedFollowUpText = isQueuedSpeakerFirstTurn
              ? this.applyFirstTurnIntroduction(
                  nextCoordinatedSpeaker,
                  queuedFollowUpText
                )
              : queuedFollowUpText;

            if (this.looksLikeClosingLanguage(finalQueuedFollowUpText)) {
              await this.setQueuedPanelFollowUp(null);
            } else {
              await this.setQueuedPanelFollowUp({
                speakerId: nextCoordinatedSpeaker,
                text: finalQueuedFollowUpText,
                createdAt: new Date().toISOString()
              });
            }
          }

          // Save any memories embedded in the specialist response
          const memoryRegex = /\[MEMORY:\s*([^=]+)=([^\]]+)\]/g;
          for (const match of specialistText.matchAll(memoryRegex)) {
            await this.saveMemory(match[1].trim(), match[2].trim());
          }

          // Pipe the specialist text into the UI stream
          const msgId = generateId();
          const specialistStream = new ReadableStream({
            start(controller) {
              controller.enqueue({ type: "text-start", id: msgId });
              controller.enqueue({
                type: "text-delta",
                id: msgId,
                delta: specialistText
              });
              controller.enqueue({ type: "text-end", id: msgId });
              controller.close();
            }
          });

          writer.merge(specialistStream as ReadableStream);

          // Notify AIChatAgent that the turn is complete
          // biome-ignore lint/suspicious/noExplicitAny: SDK callback
          (onFinish as any)({
            text: specialistText,
            usage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
            finishReason: "stop",
            toolCalls: [],
            toolResults: []
          });

          return; // done for this specialist turn
        }

        // ── Orchestrator / Behavioral — handled directly ─────────────────
        const orchestratorSystem =
          route.mode === "closing"
            ? `You are Alex Monroe, the moderator of a live panel interview at PanelAI.

## Task
- Close the interview naturally
- Thank the candidate and summarize that the panel will deliberate
- Always ask exactly: "Do you have any questions for the panel?"
- Keep it concise and warm

## Rules
- Stay in character as Alex Monroe
- Do not reveal you are an AI unless directly asked
- Save candidate info when relevant using [MEMORY: key=value]

${memoryContext}

MEMORY: Save persistent facts like [MEMORY: name=John], [MEMORY: role_applied=Engineer].`
            : `You are Alex Monroe, the moderator of a live panel interview at PanelAI.

## Your Panel
- **Alex Monroe** (you) — Orchestrator & Moderator. Warm, professional, puts candidates at ease.
- **Sarah Park** — HR & Recruiter.
- **Dr. Raj Patel** — Technical Interviewer.
- **Maya Chen** — Culture & Values.
- **James Liu** — Domain Expert.
- **Lisa Torres** — Behavioral Analyst.

## Runtime Coordination
- Routing reason for this turn: ${route.reason}
- The interview is intentionally non-linear.
- Specialists can ask consecutive follow-ups when depth is needed.
- Any specialist combination can coordinate when the candidate response spans multiple areas.
- Do not force rigid round-robin sequencing.

## Your Task For This Turn
- Speak as Alex Monroe
- Moderate naturally, acknowledge the candidate's last response, and hand off to the best next specialist
- Ask at most one concise moderator question if clarification is needed
- If the candidate appears finished and all specialists have participated, move to closing

## Rules
- Never break character. Real panel interview in progress.
- Do not reveal you are an AI unless directly asked.
- Save candidate info: [MEMORY: key=value]

${memoryContext}

MEMORY: Save persistent facts like [MEMORY: name=John], [MEMORY: role_applied=Engineer].`;

        const result = streamText({
          system: orchestratorSystem,
          messages: await convertToModelMessages(processedMessages),
          model,
          tools: shouldUseTool ? allTools : undefined,
          toolChoice: shouldUseTool ? "auto" : undefined,
          onFinish: async (result) => {
            const text = result.text;
            const memoryRegex = /\[MEMORY:\s*([^=]+)=([^\]]+)\]/g;
            for (const match of text.matchAll(memoryRegex)) {
              await this.saveMemory(match[1].trim(), match[2].trim());
            }
            // biome-ignore lint/suspicious/noExplicitAny: Type mismatch with SDK callback
            (onFinish as any)(result);
          },
          abortSignal: options?.abortSignal
        });

        const mergedStream = result
          .toUIMessageStream({
            onError: (error) => {
              const message =
                error instanceof Error ? error.message : String(error);
              if (message.includes("4006") || message.includes("neurons")) {
                return "Alex Monroe: We have reached the current AI inference quota for this environment. Please switch to another open model in AI_MODEL or retry when quota resets.";
              }
              return "Alex Monroe: I hit a temporary generation issue. Please retry your last answer.";
            }
          })
          .pipeThrough(
            new TransformStream({
              // biome-ignore lint/suspicious/noExplicitAny: SDK stream chunk types are broad unions
              transform(chunk: any, controller) {
                if (chunk?.type !== "error") {
                  controller.enqueue(chunk);
                  return;
                }
                const fallbackId = `fallback-${generateId()}`;
                controller.enqueue({ type: "text-start", id: fallbackId });
                controller.enqueue({
                  type: "text-delta",
                  id: fallbackId,
                  delta:
                    typeof chunk.errorText === "string"
                      ? chunk.errorText
                      : "Alex Monroe: I hit a temporary generation issue. Please retry your last answer."
                });
                controller.enqueue({ type: "text-end", id: fallbackId });
              }
            })
          );

        writer.merge(mergedStream);
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
          { type: "text", text: `Running scheduled task: ${description}` }
        ],
        metadata: { createdAt: new Date() }
      }
    ]);
  }
}
