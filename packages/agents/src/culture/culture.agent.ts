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
import type { AgentRole } from "@panelai/shared";
import {
  conductCultureInterview,
  type ConductCultureInterviewPayload
} from "./culture.tools.js";

export class CultureInterviewerAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "culture";
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
      return conductCultureInterview(
        this.card.id,
        message.payload as ConductCultureInterviewPayload
      );
    }

    return super.onDelegation(message);
  }
}
