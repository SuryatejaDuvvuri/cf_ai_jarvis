# ADR-004: A2A Protocol Implementation and Agent Design

## Status

Accepted

## Date

2026-04-07

## Context

We need to implement agent-to-agent communication for PanelAI's multi-agent panel interview system. The Google A2A protocol provides a standard for agent interoperability, but we're running all agents as Cloudflare Durable Objects within the same Worker, not as separate HTTP services.

Key questions resolved:

- How do agents discover each other?
- How do agents communicate?
- How does human-in-the-loop approval work?
- How do agents share context vs. keep assessments private?
- How do agents deliberate after interviews?
- What does the candidate experience look like?

## Decisions

### 1. Agent Discovery: Hybrid Static + Dynamic Registry

**Decision:** Core agents (Orchestrator, Recruiter, Technical, Culture) are statically registered at compile time. Custom Domain Expert agents can be dynamically registered at runtime.

**Rationale:** Static registration is simpler and sufficient for our 5 core agents. Dynamic registration allows future extensibility for role-specific Domain Experts without code changes.

### 2. Human Approval: In Artifact

**Decision:** When an agent's output requires human approval, it sets `requiresApproval: true` in the Artifact. The Orchestrator surfaces these to the UI.

**Rationale:** Simpler than adding a custom Task state. The Artifact already contains the assessment — adding a flag keeps approval logic co-located with the data being approved.

### 3. Transport: Direct DO Stubs, A2A-Ready

**Decision:** Internal agent-to-agent calls use direct Durable Object stub invocation (`env.AGENT.get(id).fetch()`). The message format follows A2A conventions so we can expose HTTP endpoints for external agents later.

**Rationale:** DO stubs are lower latency and simpler for internal calls. A2A-compatible message shapes mean we can add HTTP transport later without refactoring agent logic.

### 4. Memory Model: Hybrid Shared + Private

**Decision:**

- **Shared (read-only during interview):** Candidate profile, job requirements, interview config, topics already covered
- **Private (per-agent):** Each agent's scores, notes, and assessments — not visible to other agents until deliberation

**Rationale:** Prevents groupthink. Like real interviewers, each agent forms an independent assessment. They only see each other's scores during deliberation, not during their interview segment.

### 5. Deliberation: Round-Robin Synthesis

**Decision:** After all interview segments complete, Orchestrator runs round-robin deliberation:

1. Collect all agent Artifacts
2. Ask each agent to comment on findings (without seeing others' comments first)
3. Orchestrator synthesizes into final scorecard with recommendation
4. Human makes final decision

**Rationale:** Preserves independence of assessments while allowing agents to surface concerns about each other's findings. Mirrors real panel interview debrief meetings.

### 6. Interview Flow Control: Orchestrator Decides

**Decision:** Orchestrator automatically advances between interview phases (Technical → Culture → Domain). No human gate between phases.

**Rationale:** Reduces friction for candidates. Human oversight happens before (approving who interviews) and after (final hire/reject decision), not during.

### 7. Candidate UX: Voice-First Panel View

**Decision:**

- Complete voice UI — candidates speak and listen, no text chat
- Panel view with multiple agent avatars arranged around Orchestrator (Nick Fury / SHIELD board style)
- Active speaker's icon enlarges/glows
- Visible handoffs: "Now speaking: Technical Lead..."

**Rationale:** Voice-first matches real interview experience. Visual panel with active speaker indicator gives candidates context on who they're talking to without text UI clutter.

### 8. Voice Persona: Configurable Per Agent

**Decision:** Each agent's Agent Card includes `voiceId` (TTS voice selection) and `personality` traits. Different agents have different voices.

**Rationale:** Reinforces that candidates are talking to different interviewers. Deepgram supports multiple voices; we use this to create distinct personas.

### 9. Orchestrator Visibility: Visible Moderator

**Decision:** Orchestrator is visible to candidates. It speaks for intro, transitions, and outro. Individual agents handle their own segments.

**Rationale:** Candidates know the Orchestrator exists and that it's coordinating. This feels more professional than silent transitions.

### 10. Session Resume: Recap Then Resume

**Decision:** If a candidate disconnects and reconnects mid-interview:

1. Orchestrator provides brief recap of where we left off
2. Active interviewer resumes from last question
3. Previous phase assessments are preserved

**Rationale:** Context helps both candidate and agents. Previous phases shouldn't be repeated — that data is already captured.

### 11. Error Handling: Graceful Degradation

**Decision:** If an agent fails mid-interview (timeout, API error):

1. Save all context gathered so far
2. Notify candidate: "We're experiencing technical difficulties. We'll let you know when you can resume."
3. Flag interview as `interrupted` for human review
4. Do not auto-retry or continue with partial panel

**Rationale:** Partial interviews produce incomplete assessments. Better to pause and resume than produce a flawed scorecard.

### 12. Assessment Artifact Structure

**Decision:** Each interviewer agent produces an Artifact with this structure:

```typescript
interface InterviewerArtifact {
  agentId: string;
  candidateId: string;
  interviewId: string;

  scores: {
    [criterion: string]: {
      score: 1 | 2 | 3 | 4 | 5;
      jdRequirement: string; // What the JD asked for
      evidence: string; // What candidate demonstrated
      justification: string; // Why this score
    };
  };

  strengths: Array<{ point: string; evidence: string }>;
  concerns: Array<{ point: string; evidence: string }>;

  recommendation: "strong-advance" | "advance" | "discuss" | "reject";
  recommendationRationale: string;

  requiresApproval: boolean;

  questionsAsked: Array<{ question: string; responseSummary: string }>;

  timestamp: string;
}
```

**Rationale:** Evidence-based scoring with JD alignment mirrors how human interviewers justify their ratings to hiring managers. Every score has a "why" that can be audited.

## Consequences

### Positive

- Clear separation of concerns between agents
- Independent assessments reduce groupthink bias
- A2A-compatible design allows future external agent integration
- Voice-first UX matches real interview experience
- Human maintains decision authority at key points

### Negative

- More complex than single-agent system
- Latency accumulates across agent handoffs
- Evidence-based artifacts require more LLM tokens per assessment

### Risks

- Agent disagreements need conflict resolution in Orchestrator
- Voice persona consistency depends on TTS quality
- Session resume adds state management complexity

## References

- [Google A2A Protocol Spec](https://a2a-protocol.org/latest/specification/)
- [DeepLearning.AI A2A Course](https://goo.gle/dlai-a2a)
- [Plan Document: glimmering-mixing-axolotl.md](./.claude/plans/glimmering-mixing-axolotl.md)
