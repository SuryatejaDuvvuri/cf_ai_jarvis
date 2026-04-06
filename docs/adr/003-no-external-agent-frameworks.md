# ADR 003: No External Agent Frameworks — Borrow Patterns, Not Dependencies

## Status

Accepted (2026-04-05)

## Context

Multiple multi-agent frameworks exist: Microsoft AutoGen, LangGraph, CrewAI, BeeAI (IBM), OpenClaw, Google ADK. We need to decide whether to adopt one as a dependency or implement patterns natively.

## Decision

**Build natively on Cloudflare Agents SDK.** Borrow design patterns from established frameworks but implement them in TypeScript without adding framework dependencies.

### Patterns Borrowed

| Pattern                   | Source               | Our Implementation                                         |
| ------------------------- | -------------------- | ---------------------------------------------------------- |
| Reflection                | Andrew Ng, LangGraph | `CoreAgent.reflect()` — generate → evaluate → refine       |
| Tool Use                  | Andrew Ng, LangGraph | Vercel AI SDK tool system (already built)                  |
| Planning                  | Andrew Ng, LangGraph | `Orchestrator.plan()` — decompose → assign → track         |
| Multi-Agent Collaboration | Andrew Ng, AutoGen   | A2A task delegation via `getAgentByName()`                 |
| Group Chat with Manager   | AutoGen              | `Orchestrator.runDeliberation()` — round-robin assessments |
| Sequential Chat           | AutoGen              | Phase engine chains agent segments                         |
| Nested Chat               | AutoGen              | Internal tool calls invisible to candidate                 |
| Event-Driven Messaging    | AutoGen v0.4, BeeAI  | Task objects with lifecycle states in shared KV            |

### Frameworks Evaluated

| Framework      | Why Not                                                                      |
| -------------- | ---------------------------------------------------------------------------- |
| **OpenClaw**   | Full system access (security risk). Not designed for enterprise multi-agent. |
| **AutoGen**    | Python/C# only. Not serverless-compatible.                                   |
| **CrewAI**     | Python only. Would need separate server infrastructure.                      |
| **LangGraph**  | Python-first. Graph-based orchestration is overkill for our linear pipeline. |
| **BeeAI**      | Has TS support but designed for VMs, not edge serverless.                    |
| **Google ADK** | Vendor lock-in to Google Cloud.                                              |

## Consequences

- **Positive:** Zero external agent framework dependencies. One language (TypeScript), one platform (Cloudflare).
- **Positive:** Full control over agent behavior — no framework abstractions hiding important details.
- **Positive:** No security risk from third-party agent runtimes accessing system resources.
- **Positive:** Lighter bundle size, faster cold starts on Workers.
- **Negative:** More code to write ourselves (agent coordination, task lifecycle, shared memory).
- **Negative:** Miss out on community plugins/integrations from these frameworks.
- **Risk:** If a framework becomes the industry standard, we may need to add compatibility later (but A2A protocol handles interop).
