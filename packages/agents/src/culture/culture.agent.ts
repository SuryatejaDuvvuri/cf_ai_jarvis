/**
 * Culture Fit Interviewer Agent
 *
 * Assesses candidate alignment with company values, team dynamics,
 * and work style preferences.
 *
 * Responsibilities:
 * - Ask behavioral questions (STAR format)
 * - Evaluate communication style
 * - Assess teamwork and collaboration signals
 * - Check alignment with company values
 * - Score culture fit with rubric
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
  conductCultureInterview,
  type ConductCultureInterviewPayload
} from "./culture.tools.js";

const CULTURE_CRITERIA: CriterionTemplate[] = [
  {
    key: "collaboration",
    jdRequirement: "Effective collaboration in cross-functional teams"
  },
  {
    key: "ownership",
    jdRequirement: "Takes ownership and follows through"
  }
];

export class CultureInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "culture";
  }

  private async scoreDelegatedInterview(
    payload: ConductCultureInterviewPayload
  ): Promise<InterviewerArtifact> {
    const fallback = conductCultureInterview(this.card.id, payload).artifact;
    const transcript = formatTranscriptForPrompt(payload.transcript);

    const result = await generateText({
      model: this.resolveModel(),
      maxOutputTokens: 350,
      maxRetries: 0,
      system: `You are Maya Chen evaluating a completed culture/values interview segment.

Return ONLY valid JSON with this structure:
{
  "scores": {
    "collaboration": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." },
    "ownership": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." }
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
- If evidence is weak, score lower and explicitly call out gaps.
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
      taskContext: `Culture artifact for interview ${payload.interviewId ?? "unknown"} and candidate ${payload.candidateId ?? "unknown"}. Transcript evidence must drive scores.`,
      outputContract:
        "Return valid JSON with keys: scores.collaboration, scores.ownership, strengths[], concerns[], recommendation, recommendationRationale, questionsAsked[], notes.",
      maxIterations: 1
    });

    const draft = parseJsonObjectFromText(reflectedDraftText);
    return buildArtifactFromDraft({
      agentId: this.card.id,
      payload,
      criteria: CULTURE_CRITERIA,
      fallback,
      draft
    });
  }

  protected override getInterviewSystemPrompt(
    candidateContext?: string
  ): string {
    return `You are Maya Chen, the Culture & Values Interviewer at PanelAI. You evaluate whether candidates align with the team's values, communication style, and collaborative spirit.

## Your Persona
- Speak as Maya Chen, but do not re-introduce yourself after the first turn in this interview
- Warm, empathetic, and genuinely curious about people
- Listen for signals about self-awareness, adaptability, and emotional intelligence
- Use open-ended questions that invite storytelling

## Your Focus Areas
- Teamwork and collaboration: how they work with others, handle disagreement
- Communication: clarity, active listening, giving and receiving feedback
- Values alignment: what drives them, what they look for in a team
- Adaptability: how they handle ambiguity, change, and failure

## Rules
- Ask exactly ONE culture/values/collaboration question per response
- Do not ask technical or purely HR logistical questions
- Never reveal you are an AI unless directly asked
- Stay in character as Maya Chen throughout

${candidateContext ? `\n## Candidate Context\n${candidateContext}` : ""}`;
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-culture-interview") {
      const payload = message.payload as ConductCultureInterviewPayload;
      await this.logActivity(
        payload.interviewId,
        "scoring-started",
        "Maya Chen is reviewing the culture & collaboration transcript…"
      );
      try {
        const artifact = await this.scoreDelegatedInterview(payload);
        await this.logActivity(
          payload.interviewId,
          "score-produced",
          `Maya Chen recommends: ${artifact.recommendation}.`,
          { recommendation: artifact.recommendation, scores: artifact.scores }
        );
        return {
          handled: true,
          recommendation: artifact.recommendation,
          summary: "Culture interview completed",
          artifact
        };
      } catch (error) {
        console.error("Culture delegated scoring failed:", error);
        await this.logActivity(
          payload.interviewId,
          "delegation-failed",
          "Culture scoring fell back to heuristic rubric.",
          { error: String(error) }
        );
        return conductCultureInterview(this.card.id, payload);
      }
    }

    return super.onDelegation(message);
  }
}
