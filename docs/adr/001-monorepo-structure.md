# ADR 001: Turborepo Monorepo Structure

## Status

Accepted (2026-04-05)

## Context

The project is evolving from a single-package voice assistant into a multi-agent platform with separate concerns: core agent infrastructure, specialist agent implementations, a React frontend, shared types/utilities, and a Cloudflare Worker entry point.

We need a structure that:

- Separates concerns cleanly (core vs agents vs frontend vs deployment)
- Allows independent testing per package
- Scales to offshore team collaboration (clear ownership boundaries)
- Supports Cloudflare's Vite plugin constraint (index.html must be at vite config root)

## Decision

Use **Turborepo** as the monorepo build orchestrator with npm workspaces.

5 packages under `packages/`:

- `@panelai/shared` — types, constants, utilities
- `@panelai/core` — base agent class, A2A protocol, memory
- `@panelai/agents` — specialist agents (Orchestrator, Recruiter, Technical, Culture, Domain Expert)
- `@panelai/frontend` — React UI (source-only, not independently built)
- `@panelai/worker` — Cloudflare Worker entry, Vite build root

**Critical constraint:** `@panelai/worker` is the build root. The `@cloudflare/vite-plugin` expects `index.html` at the Vite config root and builds both worker and client together. Frontend package is source-only — imported by the worker's Vite build via workspace resolution.

## Consequences

- **Positive:** Clean package boundaries, parallel test execution, clear CODEOWNERS, independent versioning via Changesets
- **Positive:** New developers (or offshore) can focus on one package without understanding the whole system
- **Negative:** Upfront restructuring effort (moving all existing files)
- **Negative:** Slightly more complex import paths (`@panelai/shared` instead of `./shared`)
- **Risk:** If Cloudflare Vite plugin changes its expectations, we may need to adjust the worker package structure

## Alternatives Considered

1. **Keep single package** — simpler now, but becomes unmanageable as agent count grows. No clean boundaries for team ownership.
2. **Nx** — more powerful but heavier. Turborepo is lighter and sufficient for our scale.
3. **Separate repos per package** — overkill. Adds deployment complexity without enough benefit at our scale.
