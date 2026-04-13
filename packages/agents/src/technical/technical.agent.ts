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
import type { AgentRole } from "@panelai/shared";
import {
  conductTechnicalInterview,
  type ConductTechnicalInterviewPayload
} from "./technical.tools.js";

export class TechnicalInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "technical";
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
      return conductTechnicalInterview(
        this.card.id,
        message.payload as ConductTechnicalInterviewPayload
      );
    }

    return super.onDelegation(message);
  }
}
