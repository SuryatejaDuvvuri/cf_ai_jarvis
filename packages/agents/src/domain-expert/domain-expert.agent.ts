/**
 * Domain Expert Interviewer Agent
 *
 * Evaluates domain-specific knowledge relevant to the role.
 * Configurable per job posting (e.g., ML, finance, healthcare).
 *
 * Responsibilities:
 * - Ask domain-specific questions
 * - Evaluate depth of expertise
 * - Assess practical experience in the domain
 * - Score domain knowledge with rubric
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
  conductDomainInterview,
  type ConductDomainInterviewPayload
} from "./domain-expert.tools.js";

const DOMAIN_CRITERIA: CriterionTemplate[] = [
  {
    key: "domainDepth",
    jdRequirement: "Domain-specific architecture and execution depth"
  }
];

export class DomainExpertAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "domain-expert";
  }

  private async scoreDelegatedInterview(
    payload: ConductDomainInterviewPayload
  ): Promise<InterviewerArtifact> {
    const fallback = conductDomainInterview(this.card.id, payload).artifact;
    const transcript = formatTranscriptForPrompt(payload.transcript);

    const result = await generateText({
      model: this.resolveModel(),
      maxOutputTokens: 350,
      maxRetries: 0,
      system: `You are James Liu evaluating a completed domain-expert interview segment.

Return ONLY valid JSON with this structure:
{
  "scores": {
    "domainDepth": { "score": 1-5, "jdRequirement": "...", "evidence": "...", "justification": "..." }
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
- If evidence is weak, score lower and explicitly call out missing proof.
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
      taskContext: `Domain artifact for interview ${payload.interviewId ?? "unknown"} and candidate ${payload.candidateId ?? "unknown"}. Transcript evidence must drive scores.`,
      outputContract:
        "Return valid JSON with keys: scores.domainDepth, strengths[], concerns[], recommendation, recommendationRationale, questionsAsked[], notes.",
      maxIterations: 1
    });

    const draft = parseJsonObjectFromText(reflectedDraftText);
    return buildArtifactFromDraft({
      agentId: this.card.id,
      payload,
      criteria: DOMAIN_CRITERIA,
      fallback,
      draft
    });
  }

  protected override getInterviewSystemPrompt(
    candidateContext?: string
  ): string {
    return `You are James Liu, the Domain Expert Interviewer at PanelAI. You dive deep into domain-specific knowledge relevant to the role — the real-world experience and nuanced expertise that separates strong candidates from great ones.

## Your Persona
- Speak as James Liu, but do not re-introduce yourself after the first turn in this interview
- Thoughtful, knowledgeable, direct
- Ask about practical application, not just theoretical knowledge
- Probe for specific examples and concrete outcomes

## Your Focus Areas
- Role-specific domain knowledge (industry, tools, methodologies)
- Real-world application of expertise
- Depth vs. breadth of domain experience
- Lessons learned from past domain-specific projects or challenges

## Rules
- Ask exactly ONE domain-specific question per response
- Do not ask generic technical or HR questions
- Never reveal you are an AI unless directly asked
- Stay in character as James Liu throughout

${candidateContext ? `\n## Candidate Context\n${candidateContext}` : ""}`;
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "conduct-domain-interview") {
      const payload = message.payload as ConductDomainInterviewPayload;
      await this.logActivity(
        payload.interviewId,
        "scoring-started",
        "James Liu is evaluating domain depth…"
      );
      try {
        const artifact = await this.scoreDelegatedInterview(payload);
        await this.logActivity(
          payload.interviewId,
          "score-produced",
          `James Liu recommends: ${artifact.recommendation}.`,
          { recommendation: artifact.recommendation, scores: artifact.scores }
        );
        return {
          handled: true,
          recommendation: artifact.recommendation,
          summary: "Domain interview completed",
          artifact
        };
      } catch (error) {
        console.error("Domain delegated scoring failed:", error);
        await this.logActivity(
          payload.interviewId,
          "delegation-failed",
          "Domain scoring fell back to heuristic rubric.",
          { error: String(error) }
        );
        return conductDomainInterview(this.card.id, payload);
      }
    }

    return super.onDelegation(message);
  }
}
