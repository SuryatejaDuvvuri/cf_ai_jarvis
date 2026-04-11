/**
 * Interview types - Session, Candidate, Config
 *
 * Core types for the interview flow from scheduling
 * through completion.
 */

import type { AgentRef, AgentRole } from "./agent-card.js";
import type { CombinedScorecard, RecruiterArtifact } from "./artifact.js";

/** Interview phase states */
export type InterviewPhase =
  | "scheduled" // Interview scheduled, not started
  | "prep" // Agents loading context
  | "intro" // Orchestrator introduction
  | "technical" // Technical interview segment
  | "culture" // Culture fit segment
  | "domain" // Domain expertise segment
  | "deliberation" // Agents discussing findings
  | "reporting" // Generating final report
  | "completed" // Interview finished
  | "interrupted" // Paused due to error/disconnect
  | "canceled"; // Canceled before completion

/** Phase configuration */
export interface PhaseConfig {
  /** Phase identifier */
  phase: InterviewPhase;
  /** Assigned agent */
  agent: AgentRef;
  /** Target duration in minutes */
  durationMinutes: number;
  /** Minimum questions to ask */
  minQuestions: number;
  /** Maximum questions to ask */
  maxQuestions: number;
  /** Topics to cover */
  topics: string[];
}

/** Interview configuration */
export interface InterviewConfig {
  /** Job ID this interview is for */
  jobId: string;
  /** Interview type */
  type: "panel" | "single";
  /** Phase sequence */
  phases: PhaseConfig[];
  /** Total target duration in minutes */
  totalDurationMinutes: number;
  /** Allow agent to extend if needed */
  allowExtension: boolean;
  /** Scoring rubric to use */
  rubricId?: string;
}

/** Candidate profile */
export interface CandidateProfile {
  /** Unique candidate ID */
  id: string;
  /** Full name */
  name: string;
  /** Email address */
  email: string;
  /** Phone number */
  phone?: string;
  /** Current location */
  location?: string;
  /** Resume file URL or content */
  resumeUrl?: string;
  /** Parsed resume data from Recruiter */
  parsedResume?: RecruiterArtifact["parsedResume"];
  /** LinkedIn URL */
  linkedInUrl?: string;
  /** Portfolio/website URL */
  portfolioUrl?: string;
  /** Application date */
  appliedAt: string;
  /** Current status in pipeline */
  status: CandidateStatus;
  /** Notes from recruiters/hiring managers */
  notes?: string;
  /** Tags for filtering */
  tags?: string[];
}

/** Candidate pipeline status */
export type CandidateStatus =
  | "applied" // Just applied
  | "screening" // Being screened by Recruiter Agent
  | "shortlisted" // On shortlist, pending human approval
  | "approved" // Human approved for interview
  | "scheduled" // Interview scheduled
  | "interviewing" // Currently in interview
  | "deliberation" // Interview done, in deliberation
  | "pending-decision" // Ready for human decision
  | "hired" // Offer extended/accepted
  | "rejected" // Rejected at any stage
  | "withdrawn"; // Candidate withdrew

/** Phase state during interview */
export interface PhaseState {
  /** Current phase */
  phase: InterviewPhase;
  /** Phase start time */
  startedAt: string;
  /** Active agent */
  activeAgent: AgentRef;
  /** Questions asked so far */
  questionsAsked: number;
  /** Topics covered */
  topicsCovered: string[];
  /** Time remaining in phase (seconds) */
  timeRemainingSeconds: number;
}

/** Interview session */
export interface InterviewSession {
  /** Unique session ID */
  id: string;
  /** Interview configuration */
  config: InterviewConfig;
  /** Candidate being interviewed */
  candidate: CandidateProfile;
  /** Current phase state */
  currentPhase: PhaseState;
  /** Phase history */
  phaseHistory: Array<PhaseState & { endedAt: string }>;
  /** Participating agents */
  agents: AgentRef[];
  /** Orchestrator reference */
  orchestrator: AgentRef;
  /** Session status */
  status: "active" | "paused" | "completed" | "canceled";
  /** Shared context visible to all agents */
  sharedContext: Record<string, unknown>;
  /** Final scorecard (populated after deliberation) */
  scorecard?: CombinedScorecard;
  /** Session timestamps */
  scheduledAt: string;
  startedAt?: string;
  completedAt?: string;
  /** Interruption info if any */
  interruption?: {
    reason: string;
    occurredAt: string;
    phase: InterviewPhase;
    canResume: boolean;
  };
}

/** Job requisition */
export interface JobRequisition {
  /** Unique job ID */
  id: string;
  /** Job title */
  title: string;
  /** Department */
  department: string;
  /** Location */
  location: string;
  /** Remote policy */
  remotePolicy: "onsite" | "hybrid" | "remote";
  /** Employment type */
  employmentType: "full-time" | "part-time" | "contract";
  /** Seniority level */
  level: "entry" | "mid" | "senior" | "lead" | "principal";
  /** Salary range */
  salaryRange?: {
    min: number;
    max: number;
    currency: string;
  };
  /** Job description (markdown) */
  description: string;
  /** Required skills */
  requiredSkills: string[];
  /** Nice-to-have skills */
  preferredSkills: string[];
  /** Minimum years of experience */
  minYearsExperience: number;
  /** Hiring manager */
  hiringManager: string;
  /** Recruiters assigned */
  recruiters: string[];
  /** Job status */
  status: "draft" | "open" | "paused" | "filled" | "canceled";
  /** Interview configuration for this role */
  interviewConfig?: Partial<InterviewConfig>;
  /** Created/updated timestamps */
  createdAt: string;
  updatedAt: string;
}

/** Interview brief prepared by Recruiter for panel */
export interface InterviewBrief {
  /** Interview session ID */
  interviewId: string;
  /** Candidate summary */
  candidateSummary: string;
  /** Key strengths to validate */
  strengthsToValidate: string[];
  /** Concerns to probe */
  concernsToProbe: string[];
  /** Suggested questions by role */
  suggestedQuestions: Record<AgentRole, string[]>;
  /** Topics already covered (to avoid repetition) */
  topicsCovered: string[];
  /** Prepared by */
  preparedBy: AgentRef;
  /** Prepared at */
  preparedAt: string;
}
