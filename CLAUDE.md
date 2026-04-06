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

Move all existing source files from the root `src/` into the correct packages. This is the riskiest step — file moves without logic changes, but all import paths must be updated.

**File mapping:**

| Current Location                                       | New Location                                 | Package           |
| ------------------------------------------------------ | -------------------------------------------- | ----------------- |
| `src/server.ts` (Chat DO class, ~lines 35-284)         | `packages/agents/src/jarvis/jarvis.agent.ts` | @panelai/agents   |
| `src/server.ts` (Worker fetch handler, ~lines 289-363) | `packages/worker/src/index.ts`               | @panelai/worker   |
| `src/server.ts` (transcribe/speak endpoints)           | `packages/worker/src/index.ts`               | @panelai/worker   |
| `src/tools.ts`                                         | `packages/agents/src/jarvis/jarvis.tools.ts` | @panelai/agents   |
| `src/utils.ts`                                         | `packages/shared/src/utils/index.ts`         | @panelai/shared   |
| `src/shared.ts`                                        | `packages/shared/src/constants/index.ts`     | @panelai/shared   |
| `src/app.tsx`                                          | `packages/frontend/src/app.tsx`              | @panelai/frontend |
| `src/client.tsx`                                       | `packages/frontend/src/client.tsx`           | @panelai/frontend |
| `src/styles.css`                                       | `packages/frontend/src/styles.css`           | @panelai/frontend |
| `src/components/`                                      | `packages/frontend/src/components/`          | @panelai/frontend |
| `src/hooks/`                                           | `packages/frontend/src/hooks/`               | @panelai/frontend |
| `src/providers/`                                       | `packages/frontend/src/providers/`           | @panelai/frontend |
| `src/lib/`                                             | `packages/frontend/src/lib/`                 | @panelai/frontend |
| `wrangler.jsonc`                                       | `packages/worker/wrangler.jsonc`             | @panelai/worker   |
| `vite.config.ts`                                       | `packages/worker/vite.config.ts`             | @panelai/worker   |
| `vitest.config.ts`                                     | `packages/worker/vitest.config.ts`           | @panelai/worker   |
| `index.html`                                           | `packages/worker/index.html`                 | @panelai/worker   |
| `env.d.ts`                                             | `packages/worker/env.d.ts`                   | @panelai/worker   |
| `biome.json`                                           | `packages/worker/biome.json`                 | @panelai/worker   |
| `.prettierrc`                                          | stays at root (global)                       | root              |
| `tests/`                                               | `packages/worker/__tests__/`                 | @panelai/worker   |
| `public/`                                              | `packages/worker/public/`                    | @panelai/worker   |

**Key challenge:** `src/server.ts` must be SPLIT — the Chat Durable Object class goes to agents package, the Worker fetch handler + HTTP routes stay in worker package. The worker imports the Chat class from `@panelai/agents`.

**Verification after Step 0.2:** `npm run dev` starts Jarvis exactly as before. `turbo run test` passes the existing sanity test.

### Remaining Phase 0 Steps (after 0.2):

- **Step 0.3:** Create `wrangler.staging.jsonc` + `wrangler.production.jsonc` (different worker names)
- **Step 0.4:** Install Husky + commitlint + lint-staged (git hooks for commit conventions)
- **Step 0.5:** Install Changesets (release management)
- **Step 0.6:** Create GitHub Actions workflows (ci.yml, deploy.yml, release.yml)
- **Step 0.7:** Create PR template, CODEOWNERS, CONTRIBUTING.md, CODE_REVIEW.md
- **Step 0.8:** Final verification, tag v0.1.0

### After Phase 0 — Product Build Phases:

- **Phase 1 (Week 3-4):** Multi-agent foundation — CoreAgent base class, A2A protocol, shared memory, agent stubs
- **Phase 2 (Week 5-8):** Full hiring pipeline + panel interview MVP — Recruiter Agent (resume parsing, scoring, shortlist), Orchestrator (phased workflow), 3 interviewer agents, dashboard UI. **This is the demo version.**
- **Phase 3 (Week 9-10):** RAG knowledge layer (external LlamaIndex service)
- **Phase 4 (Week 11-12):** CRM/ATS integrations (HubSpot, Slack, Google Calendar)
- **Phase 5 (Week 13+):** Receptionist mode (Twilio, optional)

### Key Technical Decisions (don't change these without discussing with user):

1. **Human-in-the-loop by design** — AI recommends, humans decide. All candidate advancement/rejection requires human approval
2. **No external agent frameworks** — patterns from AutoGen/LangGraph/BeeAI implemented natively in TS on Cloudflare
3. **@panelai/worker is the build root** — Cloudflare Vite plugin needs index.html at vite config root
4. **No company names in codebase** — project is "PanelAI", scope is @panelai/\*
5. **Trust + verify** — always explain complex code so user can verify intuitively
6. **npm (not pnpm)** — workspace deps use `"*"` not `"workspace:*"`

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

### Trust + Verify

When writing complex code, always include comments explaining the "why" — not just what the code does, but why it does it that way. This helps the human verify correctness intuitively without having to trace every line.

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

## Mistakes & Solutions

Track mistakes here so we never repeat them. Update this after every incident.

| Date       | Mistake                                                                                                 | Solution                                                   | Files Affected           |
| ---------- | ------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------- | ------------------------ |
| 2026-04-05 | Used `workspace:*` protocol in package.json — that's pnpm syntax. npm 9.x uses `"*"` for workspace deps | Changed all workspace deps from `"workspace:*"` to `"*"`   | packages/\*/package.json |
| 2026-04-05 | Turborepo 2.9.x requires `packageManager` field in root package.json                                    | Added `"packageManager": "npm@9.7.2"` to root package.json | package.json             |

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
