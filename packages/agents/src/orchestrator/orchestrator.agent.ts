/**
 * Orchestrator Agent
 *
 * The "conductor" of PanelAI. Manages interview workflow phases,
 * delegates tasks to specialist agents, and ensures human approval
 * at every decision point.
 *
 * Responsibilities:
 * - Decompose interview into phases (screening → technical → culture → domain)
 * - Assign tasks to specialist agents
 * - Collect and synthesize agent assessments
 * - Present recommendations to human for final decision
 * - Track candidate state through the pipeline
 */

import { CoreAgent, type DelegationMessage } from "@panelai/core";
import type { AgentRole, InterviewerArtifact } from "@panelai/shared";
import {
  advanceFromRecruiter,
  buildCombinedScorecard,
  finalizeHumanDecision,
  persistPanelOutput,
  startInterview,
  type AdvanceFromRecruiterPayload,
  type FinalizeHumanDecisionPayload,
  type StartInterviewPayload
} from "./orchestrator.tools.js";
import { conductTechnicalInterview } from "../technical/technical.tools.js";
import { conductCultureInterview } from "../culture/culture.tools.js";
import { conductDomainInterview } from "../domain-expert/domain-expert.tools.js";

export class OrchestratorAgent extends CoreAgent {
  protected get role(): AgentRole {
    return "orchestrator";
  }

  protected override async onDelegation(
    message: DelegationMessage
  ): Promise<unknown> {
    if (message.type === "start-interview") {
      return startInterview(
        message.payload as StartInterviewPayload,
        this.sharedMemory
      );
    }

    if (message.type === "advance-from-recruiter") {
      return advanceFromRecruiter(
        message.payload as AdvanceFromRecruiterPayload,
        this.sharedMemory
      );
    }

    if (message.type === "run-panel-interview") {
      const payload = message.payload as {
        interviewId: string;
        candidateId: string;
      };
      const technicalResult = await this.delegate<
        { interviewId: string; candidateId: string },
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("technical", {
        type: "conduct-technical-interview",
        payload
      });

      const cultureResult = await this.delegate<
        { interviewId: string; candidateId: string },
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("culture", {
        type: "conduct-culture-interview",
        payload
      });

      const domainResult = await this.delegate<
        { interviewId: string; candidateId: string },
        {
          artifact?: InterviewerArtifact;
          handled?: boolean;
        }
      >("domain-expert", {
        type: "conduct-domain-interview",
        payload
      });

      const technicalArtifact =
        technicalResult.result?.artifact ??
        conductTechnicalInterview("technical", payload).artifact;
      const cultureArtifact =
        cultureResult.result?.artifact ??
        conductCultureInterview("culture", payload).artifact;
      const domainArtifact =
        domainResult.result?.artifact ??
        conductDomainInterview("domain-expert", payload).artifact;

      const artifacts = [
        technicalArtifact,
        cultureArtifact,
        domainArtifact
      ].filter((a): a is InterviewerArtifact => Boolean(a));

      const scorecard = buildCombinedScorecard({
        interviewId: payload.interviewId,
        candidateId: payload.candidateId,
        artifacts
      });

      await persistPanelOutput(
        payload.interviewId,
        artifacts,
        scorecard,
        this.sharedMemory
      );

      return {
        handled: true,
        phase: "deliberation",
        scorecardStatus: scorecard.status,
        synthesizedRecommendation: scorecard.synthesizedRecommendation,
        requiresHumanDecisionAtEnd: true
      };
    }

    if (message.type === "finalize-human-decision") {
      return finalizeHumanDecision(
        message.payload as FinalizeHumanDecisionPayload,
        this.sharedMemory
      );
    }

    return super.onDelegation(message);
  }
}
