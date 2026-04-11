import type { ToolSet } from "ai";

/**
 * Interview simulation mode does not expose personal-assistant tools.
 */
export const tools = {} satisfies ToolSet;

export const executions: Record<string, (args: unknown) => Promise<unknown>> =
  {};
