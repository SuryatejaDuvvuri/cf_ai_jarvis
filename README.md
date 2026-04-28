# PanelAI — Multi-Agent AI Interview Platform

A compliance-first AI panel interview platform built on Cloudflare Workers. Seven specialized AI agents collaborate to conduct structured panel interviews, with mandatory human approval at every hiring decision point.

**Live Demo:** [panelai-staging.duvvurisuryateja95.workers.dev](https://panelai-staging.duvvurisuryateja95.workers.dev)

![Cloudflare Workers](https://img.shields.io/badge/Cloudflare-Workers-F38020?logo=cloudflare)
![Durable Objects](https://img.shields.io/badge/Durable-Objects-F38020?logo=cloudflare)
![TypeScript](https://img.shields.io/badge/TypeScript-5.0-3178C6?logo=typescript)
![React](https://img.shields.io/badge/React-19-61DAFB?logo=react)
![Turborepo](https://img.shields.io/badge/Turborepo-monorepo-EF4444?logo=turborepo)

---

## What Is This?

Every AI hiring tool on the market uses a **single AI interviewer**. PanelAI uses **seven specialized agents that deliberate together** — then the human makes the call.

This mirrors how real panel interviews work: a technical lead asks coding questions, a culture specialist asks behavioral ones, a domain expert probes role-specific depth, and a bias auditor reviews all assessments for fairness. The difference is that AI does the coordination and scoring while the hiring manager retains every decision.

**Built for compliance:** Illinois AI Video Act, NYC Local Law 144, and EU AI Act all restrict autonomous AI hiring decisions. PanelAI's architecture — multi-perspective scoring, auditable reasoning, human approval gates — is defensible from day one.

---

## Key Features

- **7 specialized AI agents** as independent Cloudflare Durable Objects, each with its own LLM session, persona, and SQLite memory
- **3D panel interview UI** — React Three Fiber council visualization with per-agent ElevenLabs voice synthesis
- **Adaptive follow-up** — detects thin/dodged answers and routes the same specialist back for a targeted probe instead of moving on
- **BiasAuditAgent** — reviews all panel artifacts post-deliberation and flags fairness issues before the scorecard is finalized
- **Full recruiter pipeline** — upload resumes, score candidates against job requirements, approve shortlist, then interview
- **Human-in-the-loop gates** — AI recommends; hiring manager approves or rejects every advancement decision
- **A2A-inspired delegation** — Orchestrator discovers agent capabilities via Agent Cards and delegates tasks using Cloudflare's `getAgentByName()`
- **Shared memory** — cross-agent state persisted in a dedicated SharedMemory Durable Object
- **Greenhouse ATS integration** — sync jobs and candidates from your ATS
- **Activity stream** — real-time log of every agent action, visible to the hiring manager

---

## Architecture

```
┌─────────────────────────────────────────────────────────┐
│                  HIRING MANAGER (Human)                  │
│     Reviews scorecards · Approves/rejects decisions     │
└──────────────────────┬──────────────────────────────────┘
                       │ approval gates
                       ▼
┌─────────────────────────────────────────────────────────┐
│              ORCHESTRATOR AGENT (Team Lead)              │
│   Delegates tasks · Synthesizes scores · Generates      │
│   hiring recommendation (never decides autonomously)    │
└──┬──────────┬──────────┬──────────┬──────────┬──────────┘
   │          │          │          │          │
┌──▼──┐  ┌───▼───┐  ┌───▼──┐  ┌───▼────┐  ┌──▼──────┐
│ HR  │  │ Tech  │  │Cult- │  │Domain  │  │Behavioral│
│Agent│  │ Lead  │  │ure   │  │Expert  │  │ Agent   │
│     │  │       │  │Agent │  │        │  │         │
│DO + │  │DO +   │  │DO +  │  │DO +    │  │DO +     │
│SQLi-│  │SQLite │  │SQLite│  │SQLite  │  │SQLite   │
│ te  │  │       │  │      │  │        │  │         │
└─────┘  └───────┘  └──────┘  └────────┘  └─────────┘
                       ▼ (post-deliberation)
              ┌─────────────────┐
              │  BIAS AUDIT DO  │
              │ Fairness review │
              │ flags per agent │
              └─────────────────┘
```

### Agent Roster

| Agent             | Persona       | Responsibility                                                                                     |
| ----------------- | ------------- | -------------------------------------------------------------------------------------------------- |
| **Orchestrator**  | Alex Monroe   | Sequences agents, prevents topic overlap, synthesizes scorecards, generates hiring recommendations |
| **Recruiter**     | Sarah Park    | Pre-interview pipeline: resume scoring, shortlist generation, Greenhouse sync                      |
| **Technical**     | Dr. Raj Patel | Coding, system design, debugging questions with adaptive follow-up                                 |
| **Culture**       | Maya Chen     | STAR-method behavioral questions, values and communication assessment                              |
| **Domain Expert** | James Liu     | Role-specific deep-dive questions, practical judgment                                              |
| **Behavioral**    | Lisa Torres   | Pattern-based behavioral analysis, concrete example extraction                                     |
| **Bias Auditor**  | _(silent)_    | Reviews all panel artifacts post-deliberation, flags fairness issues                               |

---

## Monorepo Structure

```
panelai/
├── packages/
│   ├── shared/        # @panelai/shared — Types, constants, approval gates
│   ├── core/          # @panelai/core   — CoreAgent base, A2A protocol, memory
│   ├── agents/        # @panelai/agents — 7 specialist agent implementations
│   ├── frontend/      # @panelai/frontend — React 19 UI (source-only)
│   └── worker/        # @panelai/worker  — CF Worker entry, Vite build root
├── docs/adr/          # Architecture Decision Records
├── .github/workflows/ # CI (lint+test+build) + staging auto-deploy + prod manual approval
├── turbo.json         # Turborepo pipeline
└── CLAUDE.md          # Institutional memory + AI assistant context
```

`@panelai/worker` is the build root — it owns `index.html`, `vite.config.ts`, and all `wrangler.*.jsonc` files. The `@cloudflare/vite-plugin` builds both the Worker and the React client from here. All other packages are source-only.

---

## Tech Stack

| Layer              | Technology                                                              |
| ------------------ | ----------------------------------------------------------------------- |
| **Runtime**        | Cloudflare Workers + Durable Objects                                    |
| **Agent SDK**      | `@cloudflare/agents` (`AIChatAgent`, `getAgentByName`)                  |
| **LLM**            | Workers AI — Llama 3.3 70B (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) |
| **AI SDK**         | Vercel AI SDK (`streamText`, `generateText`, `generateObject`)          |
| **Speech-to-Text** | Whisper (`@cf/openai/whisper`)                                          |
| **Text-to-Speech** | ElevenLabs per-agent voices (Workers AI TTS fallback)                   |
| **Frontend**       | React 19 + Vite + Tailwind CSS 4 + Radix UI                             |
| **3D Panel UI**    | React Three Fiber v9 + @react-three/drei                                |
| **Build**          | Turborepo + `@cloudflare/vite-plugin`                                   |
| **Testing**        | Vitest + `@cloudflare/vitest-pool-workers`                              |
| **CI/CD**          | GitHub Actions (lint → test → build → staging → prod)                   |
| **Versioning**     | Changesets                                                              |

---

## Getting Started

### Prerequisites

- Node.js 20+, npm 10+
- Cloudflare account with Workers access
- Wrangler CLI (installed automatically via `npm install`)

### Local Development

```bash
# Clone
git clone https://github.com/SuryatejaDuvvuri/cf_ai_jarvis.git
cd cf_ai_jarvis

# Install all workspace dependencies
npm install

# Copy env vars and add your API keys
cp .dev.vars.example .dev.vars

# Start local dev server
npm run dev
```

Open [http://localhost:8787](http://localhost:8787)

### Environment Variables (`.dev.vars`)

```bash
# Required — AI provider (defaults to Workers AI, no key needed)
AI_PROVIDER=workers-ai

# Optional — switch to Groq for faster responses when Workers AI rate limits
# AI_PROVIDER=groq
# AI_API_KEY=gsk_xxxx
# AI_MODEL=llama-3.3-70b-versatile

# Optional — ElevenLabs for per-agent voice synthesis
# ELEVENLABS_API_KEY=sk_xxxx

# Optional — Greenhouse ATS integration
# GREENHOUSE_API_KEY=your_key
```

---

## Interview Flow

```
Hiring Manager creates job → uploads resumes → reviews scored shortlist
    → approves candidate for interview
        → Candidate opens interview link
            → Orchestrator introduces panel
                → HR agent (motivation, logistics)
                    → Technical agent (coding, system design)
                        → Culture agent (behavioral, values)
                            → Domain Expert (role-specific depth)
                                → Behavioral agent (concrete examples)
                                    → Orchestrator synthesizes scorecard
                                        → BiasAudit reviews all artifacts
                                            → Hiring Manager sees full report
                                                → Human decides: hire / reject / follow-up
```

**Adaptive follow-up:** If the candidate gives a thin or dodged answer, the system detects it via an LLM evaluation call and routes the same specialist back with a targeted probe instruction — not a generic next question.

**Approval gates:** Every advancement and rejection requires an explicit hiring manager action. The AI never autonomously decides.

---

## Commands

```bash
npm run dev              # Start local dev server (Cloudflare mini-flare)
turbo run check          # Lint + format + type-check all packages
turbo run test           # Run all tests (parallel)
turbo run build          # Production build

# Deployment
cd packages/worker
npm run deploy:staging   # Deploy to panelai-staging.*.workers.dev
npm run deploy:prod      # Deploy to panelai.*.workers.dev
```

---

## Deployment

### Staging (auto on merge to main)

```bash
cd packages/worker && npm run deploy:staging
```

Deployed to: `https://panelai-staging.duvvurisuryateja95.workers.dev`

### Production (manual approval)

```bash
cd packages/worker && npm run deploy:prod
```

### Wrangler Configs

| Config                      | Environment | Worker Name       |
| --------------------------- | ----------- | ----------------- |
| `wrangler.jsonc`            | Local dev   | `cf-ai-jarvis`    |
| `wrangler.staging.jsonc`    | Staging     | `panelai-staging` |
| `wrangler.production.jsonc` | Production  | `panelai`         |

---

## API Reference

All endpoints are in `packages/worker/src/index.ts`.

### Jobs & Candidates

| Method | Path                                    | Description                     |
| ------ | --------------------------------------- | ------------------------------- |
| `POST` | `/api/jobs`                             | Create job requisition          |
| `GET`  | `/api/jobs`                             | List all jobs                   |
| `GET`  | `/api/jobs/:id`                         | Get job details                 |
| `POST` | `/api/jobs/:id/candidates`              | Upload candidate + resume       |
| `GET`  | `/api/jobs/:id/candidates`              | Get ranked candidates           |
| `POST` | `/api/jobs/:id/candidates/:cid/approve` | Approve candidate for interview |
| `POST` | `/api/jobs/:id/candidates/:cid/reject`  | Reject candidate                |

### Interviews

| Method | Path                            | Description                 |
| ------ | ------------------------------- | --------------------------- |
| `POST` | `/api/interviews`               | Start panel interview       |
| `GET`  | `/api/interviews`               | List all interviews         |
| `GET`  | `/api/interviews/:id`           | Get interview status        |
| `GET`  | `/api/interviews/:id/scorecard` | Get combined scorecard      |
| `GET`  | `/api/interviews/:id/activity`  | Get activity stream         |
| `POST` | `/api/interviews/:id/decision`  | Submit hire/reject decision |

### Approval Gates

| Method | Path                         | Description                       |
| ------ | ---------------------------- | --------------------------------- |
| `GET`  | `/api/approvals/pending`     | List pending approval tasks       |
| `POST` | `/api/approvals/:id/resolve` | Resolve approval (approve/reject) |

### Utilities

| Method | Path                   | Description                         |
| ------ | ---------------------- | ----------------------------------- |
| `POST` | `/transcribe`          | Whisper STT (audio → text)          |
| `POST` | `/speak`               | Workers AI TTS (text → audio)       |
| `POST` | `/api/tts/elevenlabs`  | ElevenLabs TTS with per-agent voice |
| `POST` | `/api/greenhouse/sync` | Sync jobs from Greenhouse ATS       |

---

## Key Design Decisions

### Why Cloudflare Durable Objects for agents?

Each agent is a separate DO instance with its own SQLite state, LLM session, and lifecycle. They communicate via `getAgentByName()` (Cloudflare's built-in DO-to-DO communication). This means:

- No shared state by default — isolation is free
- Each agent scales independently
- Agent memory persists across sessions automatically
- All agents deploy to the same Worker bundle — no separate services

### Why not AutoGen / LangGraph / CrewAI?

They're Python-first or require external infrastructure. We implement the same patterns natively in TypeScript:

| Pattern                   | Source    | Our implementation                               |
| ------------------------- | --------- | ------------------------------------------------ |
| Reflection                | Andrew Ng | `evaluateLastResponse()` in jarvis.agent.ts      |
| Tool Use                  | Andrew Ng | Per-agent tool registries with JSON schemas      |
| Planning                  | Andrew Ng | `Orchestrator.runPanelInterview()`               |
| Multi-Agent Collaboration | AutoGen   | A2A delegation via agent cards                   |
| Group Chat with Manager   | AutoGen   | Orchestrator as GroupChatManager in deliberation |
| Sequential Chat           | AutoGen   | Tech → Culture → Domain phase chain              |
| Event-Driven Messaging    | BeeAI     | Task objects with lifecycle states               |

### Why human-in-the-loop by design?

AI hiring tools that make autonomous decisions are: (1) legally risky under emerging AI hiring laws, (2) harder to trust, and (3) not actually better at the final call. The AI does the work (coordination, scoring, bias-checking); the human makes the decision. Every agent's reasoning is auditable.

---

## Agentic Patterns Implemented

```typescript
// Reflection — evaluates if the candidate's answer addressed the question
const assessment = await this.evaluateLastResponse(messages);
// → { addressed: false, depth: "thin", reason: "explicit-non-answer" }

// Same-speaker follow-up — passes targeted probe to specialist
if (!assessment.addressed || assessment.depth === "thin") {
  route.followUpHint = {
    priorQuestion: "What is your approach to system design?",
    assessmentReason: "explicit-non-answer"
  };
  // Specialist receives: "candidate said they didn't know — probe the gap"
}

// A2A delegation — Orchestrator delegates to BiasAudit post-deliberation
const biasResult = await this.delegate("bias-audit", {
  type: "review-panel",
  payload: { interviewId, artifacts, scorecard }
});
```

---

## Testing

```bash
# Run all tests
turbo run test

# Run specific package tests
cd packages/core && npm test

# Run with coverage
cd packages/core && npx vitest run --coverage
```

Test files: `packages/*/src/**/*.test.ts` and `packages/worker/__tests__/`

Current coverage:

- `@panelai/core` — A2A protocol, task manager, delegation, shared memory
- `@panelai/worker` — Worker fetch handler, route integration tests

---

## Contributing

See [`docs/CONTRIBUTING.md`](./docs/CONTRIBUTING.md) for setup, PR workflow, and coding conventions.

**Commit format** (enforced by commitlint):

```
feat(agents): add domain expert RAG retrieval
fix(core): resolve shared memory race condition
docs(adr): document human-in-the-loop decision
test(worker): add integration tests for scorecard endpoint
```

**Branch protection:** CI must pass + 1 review before merging to `main`.

---

## Roadmap

- [ ] **Phase 3 — RAG knowledge layer**: Domain Expert queries job description and resume indexes via Cloudflare Vectorize before asking questions
- [ ] **Phase 4 — CRM/ATS integrations**: Push scorecards to HubSpot/Salesforce, pull jobs from Greenhouse/Lever, Slack notifications
- [ ] **Phase 5 — Receptionist mode**: Extend to AI phone receptionist using Twilio WebSocket voice streams (same agent infrastructure)
- [ ] Human mid-interview intervention ("ask about GraphQL experience")
- [ ] Resume PDF parsing via LLM extraction from raw text
- [ ] Reflection pass on specialist artifacts before scoring finalization

---

## License

MIT

---

## Acknowledgments

- Built on [Cloudflare Workers AI](https://developers.cloudflare.com/workers-ai/) and the [Cloudflare Agents SDK](https://github.com/cloudflare/agents)
- Agentic patterns inspired by [AutoGen](https://github.com/microsoft/autogen), [BeeAI](https://github.com/i-am-bee/beeai-framework), [LangGraph](https://www.langchain.com/langgraph), and [Andrew Ng's agentic AI work](https://www.deeplearning.ai/)
- A2A protocol design informed by [Google's Agent2Agent specification](https://developers.googleblog.com/en/a2a-a-new-era-of-agent-interoperability/)
- 3D council visualization built with [React Three Fiber](https://r3f.docs.pmnd.rs/)
- Voice synthesis by [ElevenLabs](https://elevenlabs.io/)
