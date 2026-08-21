# PaySherlock

**AI Payment Intelligence & Investigation Agent**

> Built for the Razorpay Buildathon — Open Track

## Status: Phase 3 — Investigation Command Center

Phase 0 (monorepo tooling), Phase 1 (Razorpay Test Mode integration,
normalized payment data), and Phase 2 (the AI investigation engine —
provider-independent LLM layer, typed tool registry, bounded
planner/execution loop, deterministic evidence/hypothesis system, exposed
via `POST /investigations`) are complete. Phase 3 adds the merchant-facing
frontend (`apps/web`) — an Investigation Command Center that surfaces the
real investigation engine, plus a new `GET /overview` endpoint that reuses
Phase 2's tool pipeline to power real dashboard metrics. **Financial
actions, autonomous monitoring, and merchant approval workflows are not
implemented yet.** See [Development Status](#development-status) below and
[docs/architecture](docs/architecture) for details.

## Problem

Merchants can see _that_ a payment metric moved — a drop in success rate, a
spike in failures, a dip in revenue — but figuring out _why_ usually means
manually digging through dashboards, filtering transactions, and guessing at
correlations. That investigation work is slow, repetitive, and easy to get
wrong.

## Proposed Solution

PaySherlock is an AI agent that performs that investigation for the merchant.
Given a question or a detected anomaly, it plans an investigation, pulls
structured payment data through explicit tools, forms and tests hypotheses,
gathers evidence, identifies a likely root cause, estimates business impact,
and recommends an action — all traceable back to evidence, never a bare
assertion.

```
Merchant question / detected anomaly
        ↓
Understand intent → Investigation plan → Structured data collection
        ↓
Hypotheses → Testing → Evidence
        ↓
Root cause → Business impact estimate → Recommended action
        ↓
Merchant approval → Bounded execution → Audit log → Outcome measurement
```

## High-Level Architecture

```
apps/web            Merchant dashboard (Next.js)
apps/api             Backend/API service
packages/agent       AI agent runtime and orchestration
packages/tools        Explicit typed tools the agent calls
packages/razorpay    Razorpay integration adapter
packages/database    Database client/schema layer
packages/types        Shared TypeScript types
packages/ui           Shared UI components
workers/investigator  Background investigation worker
```

Key principles: the agent calls explicit typed tools (not a single giant
prompt); Razorpay is isolated behind a dedicated adapter; every financial
action requires a guardrail check and merchant approval before execution; AI
conclusions are backed by structured evidence. Full details in
[`AGENTS.md`](AGENTS.md).

## Technology Stack

| Layer           | Choice                                                                     |
| --------------- | -------------------------------------------------------------------------- |
| Language        | TypeScript                                                                 |
| Package manager | pnpm                                                                       |
| Monorepo        | Turborepo                                                                  |
| Frontend        | Next.js (App Router, Turbopack) + React                                    |
| UI              | Tailwind CSS v4 + Radix UI primitives                                      |
| Backend         | Node.js / TypeScript                                                       |
| Database        | PostgreSQL + Prisma                                                        |
| Background jobs | Redis + BullMQ                                                             |
| AI              | Provider-independent LLM adapter (Anthropic implemented; others pluggable) |
| Payments        | Razorpay APIs + Webhooks                                                   |

## Development Status

- [x] Monorepo structure, pnpm workspace, Turborepo, TypeScript, lint/format
- [x] Database schema (PostgreSQL + Prisma) — `Merchant`, `Order`, `Payment`, `Refund`, `PaymentEvent`, `Settlement`
- [x] Razorpay adapter (payments/orders/refunds, Test Mode, read-only) + webhook signature verification
- [x] Idempotent payment ingestion (API pull + webhook push)
- [x] Read-only payment API (`/health`, `/payments`, `/payments/:id`)
- [x] AI investigation engine — provider-independent LLM layer, 7 typed tools,
      bounded planner/execution loop, deterministic hypothesis/evidence
      system, `POST /investigations`
- [x] Evaluation harness — 5 scenarios, 100% root-cause accuracy (`pnpm --filter @paysherlock/agent run eval`)
- [x] Merchant frontend (`apps/web`) — Overview, Investigate, Payments, Issues,
      History; real API integration only, no fabricated data
      (see [apps/web/README.md](apps/web/README.md))
- [x] `GET /overview` — real merchant metrics + AI-detected issues, derived
      from Phase 2's tool pipeline via `runDeterministicSnapshot` (not
      autonomous monitoring — runs synchronously per request)
- [ ] Financial safety / guardrail system for autonomous actions (no such actions exist yet)
- [ ] Full audit logging of agent runs (investigations run in-process today; a persisted run log is a later phase)
- [ ] Autonomous/scheduled monitoring, notifications, merchant approval workflows

### Local Setup

```bash
pnpm install
cp .env.example .env   # fill in Test Mode Razorpay keys + a Postgres DATABASE_URL
pnpm --filter @paysherlock/database run db:migrate:dev
```

Working: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm test` (144 tests across the Razorpay adapter, database layer, tools,
agent, API, and web frontend — run via Turborepo, no AI credentials or
live database required for the test suite).

`pnpm --filter @paysherlock/api run dev` starts the API on `PORT` (default
`4000`) — by default with `AI_PROVIDER=deterministic`, so `POST
/investigations` works with no AI credentials at all. Set
`AI_PROVIDER=anthropic` + `AI_MODEL` + `AI_API_KEY` to use a real model.
`pnpm --filter @paysherlock/api run ingest` pulls recent payments from
Razorpay Test Mode into Postgres — safe to run repeatedly, every write is
an idempotent upsert. `pnpm --filter @paysherlock/agent run eval` runs the
5-scenario evaluation harness standalone.

`pnpm --filter @paysherlock/web dev` starts the frontend on
`http://localhost:3000` (set `NEXT_PUBLIC_API_URL` in
`apps/web/.env.local` if the API isn't on the default `http://localhost:4000`
— see [apps/web/README.md](apps/web/README.md)).

## Security Note

This project handles financial data and payment provider credentials.
Razorpay is used in **Test Mode only** — never live/production credentials.
Secrets are never committed — see `.env.example` for the required
environment variables and `AGENTS.md` for the full security and
financial-safety requirements. All Razorpay API calls happen server-side;
webhook signatures are verified before any data is processed. No
AI-initiated financial action will ever execute without an explicit
merchant approval step (no such action exists yet — see Development Status).

## Roadmap

1. **Phase 0 — Foundation** _(done)_: monorepo, tooling, conventions.
2. **Phase 1 — Payment Data & Razorpay Foundation** _(done)_: database
   schema, Razorpay adapter (read-only), webhook ingestion, basic API.
3. **Phase 2 — AI Investigation Engine** _(done)_: agent runtime, tools,
   bounded investigation loop, evidence-backed results (read-only).
4. **Phase 3 — Investigation Command Center** _(current)_: merchant
   frontend, real evidence/hypothesis/investigation UI, `GET /overview`.
5. **Phase 4**: guardrails, approvals, bounded actions, audit logging.
