import type {
  EvidencedPoint,
  InterviewQuestion,
  InterviewerArtifact,
  RecommendationLevel,
  ScoredCriterion
} from "@panelai/shared";

export interface PanelTranscriptTurn {
  role: "candidate" | "panel";
  speaker?: string;
  text: string;
}

export interface SpecialistInterviewPayload {
  interviewId?: string;
  candidateId?: string;
  transcript?: PanelTranscriptTurn[];
  candidateProfile?: unknown;
  jobRequisition?: unknown;
}

export interface CriterionTemplate {
  key: string;
  jdRequirement: string;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value !== "object" || value === null) {
    return null;
  }
  return value as Record<string, unknown>;
}

function asString(value: unknown): string | null {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function asNumber(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) {
    return value;
  }

  if (typeof value === "string") {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) {
      return parsed;
    }
  }

  return null;
}

function clampScore(value: number): 1 | 2 | 3 | 4 | 5 {
  const rounded = Math.round(value);
  if (rounded <= 1) return 1;
  if (rounded >= 5) return 5;
  return rounded as 1 | 2 | 3 | 4 | 5;
}

function normalizeRecommendation(
  value: unknown,
  fallback: RecommendationLevel
): RecommendationLevel {
  const normalized = asString(value)?.toLowerCase();
  if (
    normalized === "strong-advance" ||
    normalized === "advance" ||
    normalized === "discuss" ||
    normalized === "reject"
  ) {
    return normalized;
  }
  return fallback;
}

function normalizeScoredCriterion(
  value: unknown,
  fallback: ScoredCriterion,
  template: CriterionTemplate
): ScoredCriterion {
  const record = asRecord(value);

  return {
    score: clampScore(asNumber(record?.score) ?? fallback.score),
    jdRequirement:
      asString(record?.jdRequirement) ??
      fallback.jdRequirement ??
      template.jdRequirement,
    evidence:
      asString(record?.evidence) ??
      fallback.evidence ??
      "Insufficient interview evidence was provided for this criterion.",
    justification:
      asString(record?.justification) ??
      fallback.justification ??
      "Score estimated from available interview context."
  };
}

function normalizePoints(
  value: unknown,
  fallback: EvidencedPoint[]
): EvidencedPoint[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((entry) => {
      if (typeof entry === "string") {
        const point = entry.trim();
        if (!point) {
          return null;
        }
        return {
          point,
          evidence: "Observed in interview transcript."
        } as EvidencedPoint;
      }

      const record = asRecord(entry);
      const point = asString(record?.point);
      if (!point) {
        return null;
      }

      return {
        point,
        evidence:
          asString(record?.evidence) ?? "Observed in interview transcript."
      } as EvidencedPoint;
    })
    .filter((entry): entry is EvidencedPoint => Boolean(entry));

  return normalized.length > 0 ? normalized.slice(0, 4) : fallback;
}

function normalizeQuestions(
  value: unknown,
  fallback: InterviewQuestion[]
): InterviewQuestion[] {
  if (!Array.isArray(value)) {
    return fallback;
  }

  const normalized = value
    .map((entry) => {
      const record = asRecord(entry);
      const question = asString(record?.question);
      if (!question) {
        return null;
      }

      const followUps = Array.isArray(record?.followUps)
        ? record.followUps
            .map((item) => asString(item))
            .filter((item): item is string => Boolean(item))
        : undefined;

      const questionEntry: InterviewQuestion = {
        question,
        responseSummary:
          asString(record?.responseSummary) ??
          "Candidate response was discussed during this interview segment."
      };

      if (followUps && followUps.length > 0) {
        questionEntry.followUps = followUps;
      }

      return questionEntry;
    })
    .filter((entry): entry is InterviewQuestion => entry !== null);

  return normalized.length > 0 ? normalized.slice(0, 5) : fallback;
}

export function serializeContext(value: unknown, maxChars = 2800): string {
  if (value === undefined) {
    return "(none)";
  }

  try {
    const serialized = JSON.stringify(value, null, 2);
    if (serialized.length <= maxChars) {
      return serialized;
    }
    return `${serialized.slice(0, maxChars)}\n...truncated`;
  } catch (_error) {
    return "(unserializable context)";
  }
}

export function formatTranscriptForPrompt(
  turns: PanelTranscriptTurn[] | undefined,
  maxTurns = 50
): string {
  if (!turns || turns.length === 0) {
    return "(no transcript provided)";
  }

  const safeTurns = turns
    .map((turn) => {
      if (!turn || typeof turn.text !== "string") {
        return null;
      }

      const text = turn.text.trim();
      if (!text) {
        return null;
      }

      const roleLabel =
        turn.role === "candidate"
          ? "Candidate"
          : turn.speaker?.trim() || "Panel";

      return `${roleLabel}: ${text}`;
    })
    .filter((line): line is string => Boolean(line));

  if (safeTurns.length === 0) {
    return "(no transcript provided)";
  }

  return safeTurns.slice(-maxTurns).join("\n");
}

export function parseJsonObjectFromText(
  text: string
): Record<string, unknown> | null {
  const fencedMatch = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidateJson = fencedMatch ? fencedMatch[1] : text;

  try {
    const directParsed = JSON.parse(candidateJson);
    const directRecord = asRecord(directParsed);
    if (directRecord) {
      return directRecord;
    }
  } catch (_error) {
    // Ignore; we'll attempt bracket extraction next.
  }

  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end === -1 || end <= start) {
    return null;
  }

  try {
    const extracted = text.slice(start, end + 1);
    const parsed = JSON.parse(extracted);
    return asRecord(parsed);
  } catch (_error) {
    return null;
  }
}

export function buildArtifactFromDraft(params: {
  agentId: string;
  payload: SpecialistInterviewPayload;
  criteria: CriterionTemplate[];
  fallback: InterviewerArtifact;
  draft: Record<string, unknown> | null;
}): InterviewerArtifact {
  const { agentId, payload, criteria, fallback, draft } = params;

  const draftScores = asRecord(draft?.scores);
  const normalizedScores: Record<string, ScoredCriterion> = {};

  for (const criterion of criteria) {
    normalizedScores[criterion.key] = normalizeScoredCriterion(
      draftScores?.[criterion.key],
      fallback.scores[criterion.key] ?? {
        score: 3,
        jdRequirement: criterion.jdRequirement,
        evidence:
          "Insufficient interview evidence was provided for this criterion.",
        justification: "Score estimated from available interview context."
      },
      criterion
    );
  }

  const recommendation = normalizeRecommendation(
    draft?.recommendation,
    fallback.recommendation
  );

  return {
    agentId,
    candidateId: payload.candidateId ?? fallback.candidateId,
    interviewId: payload.interviewId ?? fallback.interviewId,
    timestamp: new Date().toISOString(),
    scores: normalizedScores,
    strengths: normalizePoints(draft?.strengths, fallback.strengths),
    concerns: normalizePoints(draft?.concerns, fallback.concerns),
    recommendation,
    recommendationRationale:
      asString(draft?.recommendationRationale) ??
      fallback.recommendationRationale,
    requiresApproval: true,
    questionsAsked: normalizeQuestions(
      draft?.questionsAsked,
      fallback.questionsAsked
    ),
    notes: asString(draft?.notes) ?? fallback.notes
  };
}
