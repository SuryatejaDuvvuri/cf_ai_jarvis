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
import type { AgentRole } from "@panelai/shared";
import {
  conductDomainInterview,
  type ConductDomainInterviewPayload
} from "./domain-expert.tools.js";

export class DomainExpertAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "domain-expert";
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
      return conductDomainInterview(
        this.card.id,
        message.payload as ConductDomainInterviewPayload
      );
    }

    return super.onDelegation(message);
  }
}
