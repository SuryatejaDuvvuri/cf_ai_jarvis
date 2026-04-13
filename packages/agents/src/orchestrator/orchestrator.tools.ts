import type {
  CombinedScorecard,
  InterviewerArtifact,
  RecommendationLevel,
  RecruiterArtifact
} from "@panelai/shared";

interface SharedMemoryLike {
  setScoped(scope: string, key: string, value: unknown): Promise<void>;
  getScoped<T>(scope: string, key: string): Promise<{ value: T } | null>;
}

export interface StartInterviewPayload {
  interviewId?: string;
  candidateProfile?: unknown;
  jobRequisition?: unknown;
}

export async function startInterview(
  payload: StartInterviewPayload,
  sharedMemory: SharedMemoryLike | null
) {
  if (payload.interviewId && sharedMemory) {
    const scope = `interview:${payload.interviewId}`;
    if (payload.candidateProfile) {
      await sharedMemory.setScoped(
        scope,
        "candidateProfile",
        payload.candidateProfile
      );
    }
    if (payload.jobRequisition) {
      await sharedMemory.setScoped(
        scope,
        "jobRequisition",
        payload.jobRequisition
      );
    }
  }

  return {
    handled: true,
    phase: "screening",
    message: "Interview orchestration initialized"
  };
}

export interface AdvanceFromRecruiterPayload {
  interviewId: string;
  recruiterArtifact: RecruiterArtifact;
}

export async function advanceFromRecruiter(
  payload: AdvanceFromRecruiterPayload,
  sharedMemory: SharedMemoryLike | null
) {
  const artifact = payload.recruiterArtifact;

  const nextPhase =
    artifact.recommendationBand === "recommended"
      ? "technical"
      : artifact.recommendationBand === "maybe"
        ? "screening"
        : "completed";

  if (sharedMemory) {
    const scope = `interview:${payload.interviewId}`;
    await sharedMemory.setScoped(scope, "recruiterArtifact", artifact);
    await sharedMemory.setScoped(scope, "candidateCoachingSummary", {
      candidateId: artifact.candidateId,
      summary: artifact.candidateCoachingSummary
    });
  }

  return {
    handled: true,
    nextPhase,
    requiresHumanDecisionAtEnd: true,
    internalOnlyScorecard: true
  };
}

const recommendationOrder: RecommendationLevel[] = [
  "strong-advance",
  "advance",
  "discuss",
  "reject"
];

function averageScore(values: number[], fallback: number = 0): number {
  if (values.length === 0) return fallback;
  return values.reduce((sum, v) => sum + v, 0) / values.length;
}

export function buildCombinedScorecard(params: {
  interviewId: string;
  candidateId: string;
  artifacts: InterviewerArtifact[];
}): CombinedScorecard {
  const recommendationValues = params.artifacts.map((artifact) =>
    recommendationOrder.indexOf(artifact.recommendation)
  );

  const worstRecommendation =
    recommendationValues.length === 0
      ? "discuss"
      : recommendationOrder[Math.max(...recommendationValues)];

  return {
    interviewId: params.interviewId,
    candidateId: params.candidateId,
    agentArtifacts: params.artifacts,
    deliberationComments: [],
    synthesizedRecommendation: worstRecommendation,
    synthesisRationale:
      "Synthesized from technical, culture, and domain interviewer outputs. Human review required for final decision.",
    overallScores: {
      technical: averageScore(
        params.artifacts.map((a) => a.scores.technicalDepth?.score ?? 3)
      ),
      collaboration: averageScore(
        params.artifacts.map((a) => a.scores.collaboration?.score ?? 3)
      ),
      domain: averageScore(
        params.artifacts.map((a) => a.scores.domainDepth?.score ?? 3)
      )
    },
    status: "ready-for-decision",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

export async function persistPanelOutput(
  interviewId: string,
  artifacts: InterviewerArtifact[],
  scorecard: CombinedScorecard,
  sharedMemory: SharedMemoryLike | null
): Promise<void> {
  if (!sharedMemory) return;

  const scope = `interview:${interviewId}`;
  const [technicalArtifact, cultureArtifact, domainArtifact] = artifacts;

  if (technicalArtifact) {
    await sharedMemory.setScoped(scope, "technicalArtifact", technicalArtifact);
  }
  if (cultureArtifact) {
    await sharedMemory.setScoped(scope, "cultureArtifact", cultureArtifact);
  }
  if (domainArtifact) {
    await sharedMemory.setScoped(scope, "domainArtifact", domainArtifact);
  }

  await sharedMemory.setScoped(scope, "combinedScorecard", scorecard);
}

export interface FinalizeHumanDecisionPayload {
  interviewId: string;
  decision: "hire" | "reject" | "follow-up";
  decidedBy: string;
  notes?: string;
}

export async function finalizeHumanDecision(
  payload: FinalizeHumanDecisionPayload,
  sharedMemory: SharedMemoryLike | null
) {
  if (!sharedMemory) {
    return {
      handled: false,
      error: "Shared memory unavailable"
    };
  }

  const scope = `interview:${payload.interviewId}`;
  const scorecardEntry = await sharedMemory.getScoped<CombinedScorecard>(
    scope,
    "combinedScorecard"
  );

  if (!scorecardEntry) {
    return {
      handled: false,
      error: "No combined scorecard found for interview."
    };
  }

  const updated: CombinedScorecard = {
    ...scorecardEntry.value,
    status: "decided",
    humanDecision: {
      decision: payload.decision,
      decidedBy: payload.decidedBy,
      decidedAt: new Date().toISOString(),
      notes: payload.notes
    },
    updatedAt: new Date().toISOString()
  };

  await sharedMemory.setScoped(scope, "combinedScorecard", updated);

  return {
    handled: true,
    phase: "completed",
    decision: updated.humanDecision?.decision
  };
}
