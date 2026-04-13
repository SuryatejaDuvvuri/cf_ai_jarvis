/**
 * Recruiter Agent
 *
 * Handles the pre-interview pipeline: resume parsing, candidate scoring,
 * and shortlist recommendations. Works BEFORE the panel interview begins.
 *
 * Responsibilities:
 * - Parse resumes (PDF, DOCX, plain text)
 * - Score candidates against job requirements
 * - Generate shortlist with rationale
 * - Present recommendations to human recruiter for approval
 * - Schedule approved candidates for panel interviews
 */

import {
  CoreAgent,
  type CoreAgentEnv,
  type DelegationMessage
} from "@panelai/core";
import type { AgentRole } from "@panelai/shared";
import {
  scoreCandidate,
  syncGreenhouseReadOnly,
  type ScoreCandidatePayload
} from "./recruiter.tools.js";

interface RecruiterEnv extends CoreAgentEnv {
  GREENHOUSE_API_KEY: string;
}

export class RecruiterAgent extends CoreAgent<RecruiterEnv> {
  protected get role(): AgentRole {
    return "recruiter";
  }

  protected override getInterviewSystemPrompt(
    candidateContext?: string
  ): string {
    return `You are Sarah Park, the HR & Recruiter at PanelAI. You cover the human side of the interview — background, motivation, logistics, expectations, and compensation alignment.

## Your Persona
- Speak as Sarah Park, but do not re-introduce yourself after the first turn in this interview
- Professional, approachable, and genuinely interested in the candidate's story
- Ask clear, direct questions without being intimidating
- Note any red flags around logistics, expectations, or compensation misalignment

## Your Focus Areas
- Career trajectory and motivation for applying
- Expectations for the role and team
- Logistics: location, start date, work authorization
- Compensation expectations and alignment
- Why they're interested in this company specifically

## Rules
- Ask exactly ONE HR/recruiting question per response
- Do not ask technical or deep behavioral questions (STAR format)
- Never reveal you are an AI unless directly asked
- Stay in character as Sarah Park throughout

${candidateContext ? `\n## Candidate Context\n${candidateContext}` : ""}`;
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "sync-greenhouse") {
      if (!this.env.GREENHOUSE_API_KEY) {
        return {
          handled: false,
          error: "Missing GREENHOUSE_API_KEY binding."
        };
      }

      return syncGreenhouseReadOnly(this.env.GREENHOUSE_API_KEY);
    }

    if (message.type === "score-candidate") {
      return scoreCandidate(message.payload as ScoreCandidatePayload);
    }

    return super.onDelegation(message);
  }
}
