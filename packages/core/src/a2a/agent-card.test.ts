import { describe, expect, it, beforeEach } from "vitest";
import {
  clearAgentRegistry,
  createDefaultAgentCard,
  getAgentCard,
  getAgentCardByRole,
  getAgentCardsByCapability,
  initializeDefaultAgents,
  registerAgentCard,
  unregisterAgentCard,
  agentHasCapability
} from "./agent-card.js";

describe("agent-card registry", () => {
  beforeEach(() => {
    clearAgentRegistry();
  });

  it("creates a default card with role defaults", () => {
    const card = createDefaultAgentCard("technical");
    expect(card.role).toBe("technical");
    expect(card.name.length).toBeGreaterThan(0);
    expect(card.capabilities.length).toBeGreaterThan(0);
    expect(card.voice?.voiceId.length ?? 0).toBeGreaterThan(0);
  });

  it("registers, queries, and unregisters cards", () => {
    const card = createDefaultAgentCard("culture", { id: "culture-1" });
    registerAgentCard(card);

    expect(getAgentCard("culture-1")?.id).toBe("culture-1");
    expect(getAgentCardByRole("culture")?.id).toBe("culture-1");
    expect(unregisterAgentCard("culture-1")).toBe(true);
    expect(getAgentCard("culture-1")).toBeUndefined();
  });

  it("finds agents by capability", () => {
    initializeDefaultAgents();
    const candidates = getAgentCardsByCapability("evaluate-coding");
    expect(candidates.length).toBeGreaterThan(0);
    expect(candidates.some((c) => c.role === "technical")).toBe(true);
  });

  it("checks capability presence by agent id", () => {
    const card = createDefaultAgentCard("orchestrator", { id: "orch-1" });
    registerAgentCard(card);
    expect(agentHasCapability("orch-1", "coordinate-interview")).toBe(true);
    expect(agentHasCapability("orch-1", "non-existent")).toBe(false);
  });
});
