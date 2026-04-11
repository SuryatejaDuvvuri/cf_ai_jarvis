// Approval string to be shared across frontend and backend
export const APPROVAL = {
  YES: "Yes, confirmed.",
  NO: "No, denied."
} as const;

// Agent roles and metadata
export * from "./agent-roles.js";

// Task state machine
export * from "./task-states.js";

// Approval gates
export * from "./approval-gates.js";
