/**
 * Technical Interviewer Agent
 *
 * Conducts technical assessment portion of panel interviews.
 * Evaluates coding skills, system design, and technical problem-solving.
 *
 * Responsibilities:
 * - Ask technical questions appropriate to role level
 * - Evaluate code quality, algorithmic thinking
 * - Assess system design abilities (for senior roles)
 * - Score technical competency with rubric
 * - Provide detailed assessment to Orchestrator
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import { generateText } from "ai";
import type { AgentRole, InterviewerArtifact } from "@panelai/shared";
import {
  buildArtifactFromDraft,
  formatTranscriptForPrompt,
  parseJsonObjectFromText,
  serializeContext,
  type CriterionTemplate
} from "../interview/evaluation.js";
import {
  conductTechnicalInterview,
  type ConductTechnicalInterviewPayload
} from "./technical.tools.js";

const TECHNICAL_CRITERIA: CriterionTemplate[] = [
  {
    key: "technicalDepth",
    jdRequirement: "Demonstrates practical coding and architecture depth"
  },
  {
    key: "problemSolving",
    jdRequirement: "Structured problem-solving and reasoning"
  }
];

export class TechnicalInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "technical";
  }

  private async scoreDelegatedInterview(
    payload: ConductTechnicalInterviewPayload
  ): Promise<InterviewerArtifact> {
    const fallback = conductTechnicalInterview(this.card.id, payload).artifact;
    const transcript = formatTranscriptForPrompt(payload.transcript);

    const result = await generateText({
      model: this.resolveModel(),
      maxOutputTokens: 350,
      maxRetries: 0,
      system: `You are Dr. Raj Patel evaluating a completed technical interview segment.

Return ONLY valid JSON with this structure:
{
  "scores": {
    "technicalDepth": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." },
    "problemSolving": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." }
  },
  "strengths": [{ "point": "...", "evidence": "..." }],
  "concerns": [{ "point": "...", "evidence": "..." }],
  "recommendation": "strong-advance|advance|discuss|reject",
  "recommendationRationale": "...",
  "questionsAsked": [{ "question": "...", "responseSummary": "...", "followUps": ["..."] }],
  "notes": "optional"
}

Rules:
- Use ONLY transcript/context evidence.
- If evidence is weak, score lower and explicitly state insufficient evidence.
- Do not include markdown code fences or extra commentary.`,
      prompt: `Interview ID: ${payload.interviewId ?? "unknown-interview"}
Candidate ID: ${payload.candidateId ?? "unknown-candidate"}

Candidate profile:
${serializeContext(payload.candidateProfile)}

Job requisition:
${serializeContext(payload.jobRequisition)}

Transcript:
${transcript}`
    });

    const reflectedDraftText = await this.reflect({
      draft: result.text,
      taskContext: `Technical artifact for interview ${payload.interviewId ?? "unknown"} and candidate ${payload.candidateId ?? "unknown"}. Transcript evidence must drive scores.`,
      outputContract:
        "Return valid JSON with keys: scores.technicalDepth, scores.problemSolving, strengths[], concerns[], recommendation, recommendationRationale, questionsAsked[], notes.",
      maxIterations: 1
    });

    const draft = parseJsonObjectFromText(reflectedDraftText);
    return buildArtifactFromDraft({
      agentId: this.card.id,
      payload,
      criteria: TECHNICAL_CRITERIA,
      fallback,
      draft
    });
  }

  protected override getInterviewSystemPrompt(
    candidateContext?: string
  ): string {
    return `You are Dr. Raj Patel, the Technical Interviewer at PanelAI. You assess candidates on coding, system design, architecture, and technical problem-solving.

## Your Persona
- Speak as Dr. Raj Patel, but do not re-introduce yourself after the first turn in this interview
- Be sharp, precise, and intellectually curious
- Probe for depth: don't accept surface-level answers
- Ask follow-up questions if an answer is vague or incomplete
- Keep responses concise — this is a conversation, not a lecture

## Your Focus Areas
- Coding & algorithms (time/space complexity, clean code)
- System design (scalability, trade-offs, architecture choices)
- Debugging approach and problem-solving process
- Technical depth appropriate to the role level

## Rules
- Ask exactly ONE technical question per response
- Do not ask HR, behavioral, or culture questions
- Never reveal you are an AI unless directly asked
- Stay in character as Dr. Raj Patel throughout

${candidateContext ? `\n## Candidate Context\n${candidateContext}` : ""}`;
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-technical-interview") {
      const payload = message.payload as ConductTechnicalInterviewPayload;
      await this.logActivity(
        payload.interviewId,
        "scoring-started",
        "Dr. Raj Patel is reviewing the technical transcript…"
      );
      try {
        const artifact = await this.scoreDelegatedInterview(payload);
        await this.logActivity(
          payload.interviewId,
          "score-produced",
          `Dr. Raj Patel recommends: ${artifact.recommendation}.`,
          { recommendation: artifact.recommendation, scores: artifact.scores }
        );
        return {
          handled: true,
          recommendation: artifact.recommendation,
          summary: "Technical interview completed",
          artifact
        };
      } catch (error) {
        console.error("Technical delegated scoring failed:", error);
        await this.logActivity(
          payload.interviewId,
          "delegation-failed",
          "Technical scoring fell back to heuristic rubric.",
          { error: String(error) }
        );
        return conductTechnicalInterview(this.card.id, payload);
      }
    }

    return super.onDelegation(message);
  }
}
