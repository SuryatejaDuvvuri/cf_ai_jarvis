/**
 * Approval gate definitions
 *
 * Defines which actions require human approval before proceeding.
 * This is core to the "AI recommends, human decides" philosophy.
 */

import type { AgentRole } from "../types/agent-card.js";

/** Types of actions that may require approval */
export type ApprovalAction =
  // Recruiter actions
  | "advance-candidate" // Move candidate to next stage
  | "reject-candidate" // Reject candidate from pipeline
  | "post-job" // Post job description to boards
  | "send-invitation" // Send interview invitation
  // Interview actions
  | "final-hire-decision" // Make hire/reject decision
  | "schedule-followup" // Schedule follow-up interview
  // CRM/Ops actions
  | "update-ats-status" // Update candidate status in ATS
  | "send-offer" // Send offer letter
  | "send-rejection"; // Send rejection email

/** Approval gate configuration */
export interface ApprovalGate {
  /** Action type */
  action: ApprovalAction;
  /** Human-readable description */
  description: string;
  /** Which agent role triggers this gate */
  triggeredBy: AgentRole[];
  /** Whether approval is always required */
  alwaysRequired: boolean;
  /** Default timeout for approval (ms), 0 = no timeout */
  timeoutMs: number;
  /** What happens on timeout */
  timeoutBehavior: "reject" | "escalate" | "auto-approve";
}

/** Approval gate definitions */
export const APPROVAL_GATES: Record<ApprovalAction, ApprovalGate> = {
  "advance-candidate": {
    action: "advance-candidate",
    description: "Approve candidate to advance to next pipeline stage",
    triggeredBy: ["recruiter", "orchestrator"],
    alwaysRequired: true,
    timeoutMs: 0,
    timeoutBehavior: "escalate"
  },
  "reject-candidate": {
    action: "reject-candidate",
    description: "Confirm rejection of candidate from pipeline",
    triggeredBy: ["recruiter", "orchestrator"],
    alwaysRequired: true,
    timeoutMs: 0,
    timeoutBehavior: "escalate"
  },
  "post-job": {
    action: "post-job",
    description: "Approve job description before posting to job boards",
    triggeredBy: ["recruiter"],
    alwaysRequired: true,
    timeoutMs: 0,
    timeoutBehavior: "escalate"
  },
  "send-invitation": {
    action: "send-invitation",
    description: "Approve interview invitation email before sending",
    triggeredBy: ["recruiter"],
    alwaysRequired: false, // Can be auto-approved for approved candidates
    timeoutMs: 86400000, // 24 hours
    timeoutBehavior: "auto-approve"
  },
  "final-hire-decision": {
    action: "final-hire-decision",
    description: "Make final hire/reject decision for candidate",
    triggeredBy: ["orchestrator"],
    alwaysRequired: true,
    timeoutMs: 0,
    timeoutBehavior: "escalate"
  },
  "schedule-followup": {
    action: "schedule-followup",
    description: "Approve scheduling of follow-up interview",
    triggeredBy: ["orchestrator"],
    alwaysRequired: false,
    timeoutMs: 172800000, // 48 hours
    timeoutBehavior: "escalate"
  },
  "update-ats-status": {
    action: "update-ats-status",
    description: "Confirm update to candidate status in ATS",
    triggeredBy: ["recruiter", "orchestrator"],
    alwaysRequired: false, // Only for certain status changes
    timeoutMs: 3600000, // 1 hour
    timeoutBehavior: "auto-approve"
  },
  "send-offer": {
    action: "send-offer",
    description: "Approve offer letter before sending to candidate",
    triggeredBy: ["orchestrator"],
    alwaysRequired: true,
    timeoutMs: 0,
    timeoutBehavior: "escalate"
  },
  "send-rejection": {
    action: "send-rejection",
    description: "Approve rejection email before sending to candidate",
    triggeredBy: ["recruiter", "orchestrator"],
    alwaysRequired: true,
    timeoutMs: 0,
    timeoutBehavior: "escalate"
  }
} as const;

/** Get approval gate for an action */
export function getApprovalGate(action: ApprovalAction): ApprovalGate {
  return APPROVAL_GATES[action];
}

/** Check if an action requires approval */
export function requiresApproval(action: ApprovalAction): boolean {
  return APPROVAL_GATES[action].alwaysRequired;
}

/** Actions that always require human approval (no exceptions) */
export const CRITICAL_ACTIONS: readonly ApprovalAction[] = [
  "advance-candidate",
  "reject-candidate",
  "post-job",
  "final-hire-decision",
  "send-offer",
  "send-rejection"
] as const;
