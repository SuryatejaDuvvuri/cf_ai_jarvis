import { beforeEach, describe, expect, it } from "vitest";
import type { AgentRef } from "@panelai/shared";
import {
  clearAgentRegistry,
  createDefaultAgentCard,
  registerAgentCard
} from "./agent-card.js";
import { clearAllTasks, getTask } from "./task-manager.js";
import { delegateToAgent } from "./delegation.js";

const from: AgentRef = {
  id: "orch",
  name: "Orchestrator",
  role: "orchestrator"
};

function mockEnv(response: Response) {
  const stub = {
    fetch: async () => response
  } as unknown as DurableObjectStub;

  const namespace = {
    idFromName: (name: string) => ({ toString: () => name }),
    get: () => stub
  } as unknown as DurableObjectNamespace;

  return {
    TECHNICAL_INTERVIEWER: namespace
  };
}

describe("delegation", () => {
  beforeEach(() => {
    clearAgentRegistry();
    clearAllTasks();
  });

  it("delegates to agent and completes task", async () => {
    registerAgentCard(createDefaultAgentCard("technical", { id: "tech-1" }));

    const env = mockEnv(
      Response.json({
        data: { recommendation: "review" }
      })
    );

    const result = await delegateToAgent({
      env,
      from,
      toRole: "technical",
      request: {
        type: "conduct-technical-interview",
        payload: { candidateId: "c1" }
      }
    });

    expect(result.success).toBe(true);
    expect(result.task.id.length).toBeGreaterThan(0);
    expect(result.result).toEqual({ recommendation: "review" });
    expect(getTask(result.task.id)?.state).toBe("completed");
  });

  it("returns error if target role is missing", async () => {
    const env = mockEnv(Response.json({ data: {} }));
    const result = await delegateToAgent({
      env,
      from,
      toRole: "technical",
      request: { type: "x", payload: {} }
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain("No agent found");
  });
});
