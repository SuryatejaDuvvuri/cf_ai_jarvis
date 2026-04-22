/**
 * Artifact - Agent output with evidence-based assessment
 *
 * Artifacts are the structured outputs agents produce after
 * completing their work. For interviewers, this is their assessment.
 */

/** Score with evidence and justification */
export interface ScoredCriterion {
  /** Numeric score (1-5 scale) */
  score: 1 | 2 | 3 | 4 | 5;
  /** What the job description required */
  jdRequirement: string;
  /** What the candidate demonstrated */
  evidence: string;
  /** Why this score was given */
  justification: string;
}

/** Point with supporting evidence */
export interface EvidencedPoint {
  /** The observation/point */
  point: string;
  /** Supporting evidence from the interview */
  evidence: string;
}

/** Question asked during interview */
export interface InterviewQuestion {
  /** The question that was asked */
  question: string;
  /** Summary of candidate's response */
  responseSummary: string;
  /** Follow-up questions if any */
  followUps?: string[];
}

/** Recommendation levels */
export type RecommendationLevel =
  | "strong-advance" // Definitely move forward
  | "advance" // Move forward with minor concerns
  | "discuss" // Need panel discussion
  | "reject"; // Do not advance

/** Interviewer assessment artifact */
export interface InterviewerArtifact {
  /** Agent that produced this artifact */
  agentId: string;
  /** Candidate being assessed */
  candidateId: string;
  /** Interview session ID */
  interviewId: string;
  /** Assessment timestamp */
  timestamp: string;

  /** Scored criteria (keyed by criterion name) */
  scores: Record<string, ScoredCriterion>;

  /** Candidate strengths observed */
  strengths: EvidencedPoint[];

  /** Concerns or areas of weakness */
  concerns: EvidencedPoint[];

  /** Overall recommendation */
  recommendation: RecommendationLevel;

  /** Detailed rationale for recommendation */
  recommendationRationale: string;

  /** Whether this assessment requires human approval */
  requiresApproval: boolean;

  /** Questions asked during this segment */
  questionsAsked: InterviewQuestion[];

  /** Additional notes */
  notes?: string;
}

/** Deliberation comment from one agent about another's assessment */
export interface DeliberationComment {
  /** Agent making the comment */
  fromAgentId: string;
  /** Agent being commented on */
  aboutAgentId: string;
  /** The comment */
  comment: string;
  /** Agreement level */
  agreement: "agree" | "partially-agree" | "disagree";
  /** Timestamp */
  timestamp: string;
}

/** Combined scorecard from all interviewers */
export interface CombinedScorecard {
  /** Interview session ID */
  interviewId: string;
  /** Candidate ID */
  candidateId: string;
  /** Individual agent artifacts */
  agentArtifacts: InterviewerArtifact[];
  /** Deliberation comments */
  deliberationComments: DeliberationComment[];
  /** Synthesized recommendation from Orchestrator */
  synthesizedRecommendation: RecommendationLevel;
  /** Orchestrator's synthesis rationale */
  synthesisRationale: string;
  /** Overall scores (averaged/weighted) */
  overallScores: Record<string, number>;
  /** Final status */
  status: "pending" | "ready-for-decision" | "decided";
  /** Human decision if made */
  humanDecision?: {
    decision: "hire" | "reject" | "follow-up";
    decidedBy: string;
    decidedAt: string;
    notes?: string;
  };
  /** Bias flags raised by the BiasAuditAgent (present if bias was detected) */
  biasFlags?: import("./bias-audit.js").BiasAuditFlag[];
  /** Timestamps */
  createdAt: string;
  updatedAt: string;
}

/** Recruiter artifact for candidate screening */
export interface RecruiterArtifact {
  /** Candidate ID */
  candidateId: string;
  /** Job ID being applied for */
  jobId: string;
  /** Timestamp */
  timestamp: string;

  /** Parsed resume data */
  parsedResume: {
    name: string;
    email?: string;
    phone?: string;
    skills: string[];
    experience: Array<{
      title: string;
      company: string;
      duration: string;
      highlights: string[];
    }>;
    education: Array<{
      degree: string;
      institution: string;
      year?: string;
    }>;
    totalYearsExperience: number;
  };

  /** Match scores against job requirements */
  matchScores: Record<string, ScoredCriterion>;

  /** Weighted score (0-100) using recruiter policy */
  weightedScore: number;

  /** Criterion-level score breakdown (0-100 each) */
  scoreBreakdown: {
    relevantExperience: number;
    projectImpact: number;
    communicationClarity: number;
    skills: number;
  };

  /** Overall fit assessment */
  fitTier: "strong-fit" | "potential-fit" | "not-a-match";

  /** Recommendation band for shortlist workflow */
  recommendationBand: "recommended" | "maybe" | "not-recommended";

  /** Reasoning for the fit assessment */
  fitRationale: string;

  /** Areas to probe during interview */
  areasToProbe: string[];

  /** Red flags if any */
  redFlags: string[];

  /** Hard knockout reasons (always explicit) */
  hardKnockouts: string[];

  /** Heavy-penalty reasons (explicit, not automatic rejection) */
  penalties: string[];

  /** Candidate-facing coaching summary (no rubric leakage) */
  candidateCoachingSummary: {
    strengths: string[];
    growthAreas: string[];
    actionableNextSteps: string[];
    encouragingSummary: string;
  };

  /** Requires human approval to advance/reject */
  requiresApproval: boolean;
}
