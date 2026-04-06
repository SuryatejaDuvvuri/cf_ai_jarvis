# ADR 002: Multi-Agent System on Cloudflare Durable Objects

## Status

Accepted (2026-04-05)

## Context

We need a multi-agent system where specialized AI agents (Orchestrator, Recruiter, Technical Interviewer, Culture Fit, Domain Expert) each maintain their own state, memory, and tools while communicating with each other.

## Decision

Each agent is a **Cloudflare Durable Object** using the **Agents SDK** (`agents` package + `@cloudflare/ai-chat`).

Communication between agents uses `getAgentByName()` from the Agents SDK, following an **A2A-inspired protocol**:

- Each agent publishes an **Agent Card** (JSON) describing capabilities
- Tasks follow lifecycle states: `submitted → working → input-required → completed → failed`
- `input-required` is the human-in-the-loop gate — agent pauses and waits for human approval
- Shared state via a dedicated `SharedMemory` Durable Object

## Consequences

- **Positive:** Each agent has its own SQLite database, WebSocket connections, and lifecycle — natural isolation
- **Positive:** Agents scale independently across Cloudflare's global network
- **Positive:** `getAgentByName()` is built into the SDK — no custom transport layer needed
- **Positive:** A2A-inspired protocol means we could eventually interop with external A2A-compliant agents
- **Negative:** DO-to-DO communication adds latency (~10-50ms per hop)
- **Negative:** Debugging cross-agent flows is harder than single-agent (need good logging/tracing)
- **Risk:** Cloudflare Agents SDK is relatively new (v0.3.x) — API may change

## Alternatives Considered

1. **Single agent with role-switching prompts** — simpler but no real isolation, no independent memory, no parallel processing. Doesn't scale.
2. **External orchestration (CrewAI/LangGraph)** — would require a separate Python server, adding infrastructure complexity and a second language to maintain.
3. **Multiple Workers (not DOs)** — Workers are stateless. We need persistent state per agent (message history, memory, scores).
