# PanelAI

Multi-agent AI panel interview platform built on Cloudflare Workers. Extends the Jarvis voice assistant into a team of specialized AI agents that conduct panel interviews, with human oversight at every decision point.

## IMPORTANT: Full Plan Document

**Read this first:** `.claude/plans/glimmering-mixing-axolotl.md` — this is the comprehensive plan with all architecture decisions, market research, phased build path, and step-by-step execution instructions. Everything below is a summary; the plan file is the source of truth.

## Current Progress (Resume From Here)

**Phase 0: Engineering Infrastructure — Step 0.2 (Move existing code into packages)**

### What's Done:

- **Step 0.0** Done: CLAUDE.md created, 3 ADR docs in `docs/adr/`
- **Step 0.1** Done: Turborepo initialized, 5 packages created with package.json + tsconfig.json + placeholder index.ts:
  - `packages/shared/` — @panelai/shared (types, constants, utils)
  - `packages/core/` — @panelai/core (base agent, A2A protocol, memory)
  - `packages/agents/` — @panelai/agents (specialist agent implementations)
  - `packages/frontend/` — @panelai/frontend (React UI, source-only)
  - `packages/worker/` — @panelai/worker (CF Worker entry, build root)
- `turbo.json` created, `turbo run check --dry` confirms all 5 packages discovered
- Root `package.json` updated with workspaces, turbo scripts, name "panelai"
- `tsconfig.base.json` created as shared base config

### What's Next — Step 0.2 (THE BIG MOVE):

Move existing source files from root `src/` into the correct packages. File mapping, split rules, and verification steps live in `.claude/plans/glimmering-mixing-axolotl.md` (Step 0.2 section) — read that before starting.

### Key Technical Decisions (don't change these without discussing with user):

1. **Human-in-the-loop by design** — AI recommends, humans decide. All candidate advancement/rejection requires human approval
2. **No external agent frameworks** — patterns from AutoGen/LangGraph/BeeAI implemented natively in TS on Cloudflare
3. **@panelai/worker is the build root** — Cloudflare Vite plugin needs index.html at vite config root
4. **No company names in codebase** — project is "PanelAI", scope is @panelai/\*
5. **npm (not pnpm)** — workspace deps use `"*"` not `"workspace:*"`

## Architecture

- **Turborepo monorepo** with `@panelai/*` packages
- **Cloudflare Workers + Durable Objects** (serverless, each agent = its own DO)
- **React 19** frontend, **Tailwind CSS 4**, **Radix UI**
- **Vitest** + `@cloudflare/vitest-pool-workers` for testing
- **GitHub Actions** for CI/CD (lint → test → build → staging → prod)
- **Changesets** for versioning + GitHub Releases

## Packages

| Package             | Purpose                                                                                       | Builds independently?                       |
| ------------------- | --------------------------------------------------------------------------------------------- | ------------------------------------------- |
| `@panelai/shared`   | Types, constants, utilities                                                                   | No (source-only)                            |
| `@panelai/core`     | Base agent class, A2A protocol, memory system                                                 | No (source-only)                            |
| `@panelai/agents`   | Specialist agent implementations (Orchestrator, Recruiter, Technical, Culture, Domain Expert) | No (source-only)                            |
| `@panelai/frontend` | React UI (chat, interview panel, dashboard)                                                   | No (source consumed by worker's Vite build) |
| `@panelai/worker`   | Cloudflare Worker entry point, Vite build root, wrangler configs                              | **Yes** (this is the build root)            |

**Important:** `@panelai/worker` is the composition root. It owns `index.html`, `vite.config.ts`, and all `wrangler.*.jsonc` files. The `@cloudflare/vite-plugin` expects `index.html` at the vite config root and handles both worker + client builds together. Other packages are source-only — consumed via workspace resolution.

## Commands

```bash
npm run dev              # Start local dev server (via packages/worker)
turbo run check          # Lint + format + type-check all packages
turbo run test           # Run all tests (parallel across packages)
turbo run build          # Production build
npm run deploy:staging   # Deploy to staging environment
npm run deploy:prod      # Deploy to production (requires manual approval in CI)
```

## Conventions

### Commits

Conventional commits enforced by commitlint:

```
feat(agents): add technical interviewer agent
fix(core): resolve shared memory race condition
docs(adr): document A2A protocol decision
test(worker): add integration tests for panel interview flow
chore(ci): add staging deployment step
```

### Testing

- Every new function gets a unit test
- Every agent gets integration tests (init, message handling, tool execution, memory)
- Every API route gets a request/response test
- Target: 80% coverage per package

### Code Review

- PRs require CI to pass + 1 review (increase to 2 when team grows)
- No direct pushes to main
- Squash merges for linear history

## Key Design Patterns

Built natively in TypeScript on Cloudflare Workers. Inspired by (but not depending on) AutoGen, LangGraph, BeeAI, and Andrew Ng's agentic design patterns.

| Pattern                            | Where Used                                                       |
| ---------------------------------- | ---------------------------------------------------------------- |
| **Reflection**                     | Agents self-evaluate scores for fairness (max 2 iterations)      |
| **Tool Use**                       | Every agent has structured tool schemas with JSON validation     |
| **Planning**                       | Orchestrator decomposes interviews into phases, assigns agents   |
| **Multi-Agent Collaboration**      | Orchestrator supervises specialist agents via A2A-inspired tasks |
| **Group Chat** (AutoGen)           | Post-interview deliberation — agents share assessments           |
| **Sequential Chat** (AutoGen)      | Interview phases chain: Tech → Culture → Domain                  |
| **Event-Driven Messaging** (BeeAI) | Agent-to-agent via structured task objects, not direct calls     |

## Decisions Log

| Date       | Decision                        | Reasoning                                                                                     |
| ---------- | ------------------------------- | --------------------------------------------------------------------------------------------- |
| 2026-04-05 | Turborepo monorepo              | Multi-package separation for team scaling + offshore readiness                                |
| 2026-04-05 | Cloudflare Agents SDK only      | Security, single language (TS), already our stack. No OpenClaw, no external Python frameworks |
| 2026-04-05 | Borrow patterns, not frameworks | AutoGen/LangGraph/BeeAI patterns implemented natively in TS                                   |
| 2026-04-05 | Human-in-the-loop by design     | AI recommends, humans decide. Built for compliance                                            |
| 2026-04-05 | @panelai scope                  | Neutral branding, no company-specific names in codebase                                       |
| 2026-04-05 | Full recruiter pipeline         | Resume parsing → scoring → shortlist before interview even starts                             |

## Environment Setup

```bash
# Prerequisites: Node.js 20+, npm 10+
git clone <repo>
npm install
cp .dev.vars.example .dev.vars  # Add your API keys
npm run dev                      # Start local dev server
```

## Environments

| Environment | Worker Name          | Config File                                 | Auto-deploy?              |
| ----------- | -------------------- | ------------------------------------------- | ------------------------- |
| Dev         | local (wrangler dev) | `packages/worker/wrangler.jsonc`            | N/A                       |
| Staging     | `panelai-staging`    | `packages/worker/wrangler.staging.jsonc`    | Yes (on merge to main)    |
| Production  | `panelai`            | `packages/worker/wrangler.production.jsonc` | Manual approval in GitHub |
