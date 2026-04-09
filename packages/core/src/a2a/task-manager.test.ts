import { beforeEach, describe, expect, it } from "vitest";
import {
  clearAllTasks,
  completeTask,
  createTask,
  failTask,
  getTaskWithHistory,
  provideInput,
  requestInput,
  startTask
} from "./task-manager.js";
import type { AgentRef } from "@panelai/shared";

const from: AgentRef = {
  id: "orch",
  name: "Orchestrator",
  role: "orchestrator"
};
const to: AgentRef = { id: "tech", name: "Tech", role: "technical" };

describe("task-manager", () => {
  beforeEach(() => {
    clearAllTasks();
  });

  it("creates and transitions through happy path", () => {
    const task = createTask(
      {
        type: "conduct-technical-interview",
        assignedTo: to,
        payload: { candidateId: "c1" }
      },
      from
    );

    startTask(task.id);
    completeTask(task.id, { ok: true });

    const stored = getTaskWithHistory(task.id);
    expect(stored?.state).toBe("completed");
    expect(stored?.result?.success).toBe(true);
    expect(stored?.transitions.length).toBe(3);
  });

  it("handles input-required flow", () => {
    const task = createTask(
      { type: "approve-shortlist", assignedTo: to, payload: {} },
      from
    );
    startTask(task.id);
    requestInput(task.id, {
      type: "confirm",
      prompt: "Approve candidate?",
      choices: ["yes", "no"],
      timeoutMs: 1000
    });

    let stored = getTaskWithHistory(task.id);
    expect(stored?.state).toBe("input-required");

    provideInput(task.id, "yes");
    stored = getTaskWithHistory(task.id);
    expect(stored?.state).toBe("working");
  });

  it("requeues failed task while retries remain", () => {
    const task = createTask(
      { type: "fragile", assignedTo: to, payload: {}, maxRetries: 2 },
      from
    );
    startTask(task.id);
    failTask(task.id, "failure");
    const stored = getTaskWithHistory(task.id);
    expect(stored?.state).toBe("submitted");
    expect(stored?.metadata.retryCount).toBe(1);
    expect(stored?.result?.success).toBe(false);
  });
});
