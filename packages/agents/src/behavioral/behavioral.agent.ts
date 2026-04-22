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
  conductBehavioralInterview,
  type ConductBehavioralInterviewPayload
} from "./behavioral.tools.js";

const BEHAVIORAL_CRITERIA: CriterionTemplate[] = [
  {
    key: "ownership",
    jdRequirement: "Takes ownership and follows through under pressure"
  },
  {
    key: "collaboration",
    jdRequirement:
      "Works effectively with others through conflict and ambiguity"
  }
];

export class BehavioralInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "behavioral";
  }

  private async scoreDelegatedInterview(
    payload: ConductBehavioralInterviewPayload
  ): Promise<InterviewerArtifact> {
    const fallback = conductBehavioralInterview(this.card.id, payload).artifact;
    const transcript = formatTranscriptForPrompt(payload.transcript);

    const result = await generateText({
      model: this.resolveModel(),
      maxOutputTokens: 350,
      maxRetries: 0,
      system: `You are Lisa Torres evaluating a completed behavioral interview segment.

Return ONLY valid JSON with this structure:
{
  "scores": {
    "ownership": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." },
    "collaboration": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." }
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
- If evidence is weak, score lower and explicitly call out missing evidence.
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
      taskContext: `Behavioral artifact for interview ${payload.interviewId ?? "unknown"} and candidate ${payload.candidateId ?? "unknown"}. Transcript evidence must drive scores.`,
      outputContract:
        "Return valid JSON with keys: scores.ownership, scores.collaboration, strengths[], concerns[], recommendation, recommendationRationale, questionsAsked[], notes.",
      maxIterations: 1
    });

    const draft = parseJsonObjectFromText(reflectedDraftText);
    return buildArtifactFromDraft({
      agentId: this.card.id,
      payload,
      criteria: BEHAVIORAL_CRITERIA,
      fallback,
      draft
    });
  }

  protected override getInterviewSystemPrompt(
    candidateContext?: string
  ): string {
    return `You are Lisa Torres, the Behavioral Interviewer at PanelAI. You assess ownership, judgment, resilience, and learning from concrete real-world examples.

## Your Persona
- Speak as Lisa Torres, but do not re-introduce yourself after the first turn in this interview
- Calm, focused, and evidence-driven
- Ask concise questions that force specificity
- Prioritize examples with measurable outcomes

## Your Focus Areas
- Ownership under ambiguity and pressure
- Decision quality, tradeoffs, and accountability
- Learning loops: what changed after setbacks
- Collaboration behavior during conflict or high stakes

## Rules
- Ask exactly ONE behavioral question per response
- Use STAR-oriented follow-ups when candidate evidence is vague
- Do not ask technical deep-dives or HR logistics
- Never close or conclude the interview
- Never ask "Do you have any questions for the panel?"
- Do not reveal you are an AI unless directly asked

${candidateContext ? `\n## Candidate Context\n${candidateContext}` : ""}`;
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-behavioral-interview") {
      const payload = message.payload as ConductBehavioralInterviewPayload;
      await this.logActivity(
        payload.interviewId,
        "scoring-started",
        "Lisa Torres is evaluating behavioral evidence…"
      );
      try {
        const artifact = await this.scoreDelegatedInterview(payload);
        await this.logActivity(
          payload.interviewId,
          "score-produced",
          `Lisa Torres recommends: ${artifact.recommendation}.`,
          { recommendation: artifact.recommendation, scores: artifact.scores }
        );
        return {
          handled: true,
          recommendation: artifact.recommendation,
          summary: "Behavioral interview completed",
          artifact
        };
      } catch (error) {
        console.error("Behavioral delegated scoring failed:", error);
        await this.logActivity(
          payload.interviewId,
          "delegation-failed",
          "Behavioral scoring fell back to heuristic rubric.",
          { error: String(error) }
        );
        return conductBehavioralInterview(this.card.id, payload);
      }
    }

    return super.onDelegation(message);
  }
}
