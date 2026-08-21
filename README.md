# PaySherlock

**AI Payment Intelligence & Investigation Agent**

> Built for the Razorpay Buildathon — Open Track

## Status: Phase 1 — Payment Data & Razorpay Foundation

Phase 0 (monorepo tooling, structure, conventions) is complete. Phase 1 adds
the Razorpay Test Mode integration and normalized payment data layer this
project's future investigations will run on. **The AI agent, dashboard, and
any financial actions are not implemented yet.** See
[Development Status](#development-status) below and
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

## Planned Technology Stack

| Layer           | Choice                                                       |
| --------------- | ------------------------------------------------------------ |
| Language        | TypeScript                                                   |
| Package manager | pnpm                                                         |
| Monorepo        | Turborepo                                                    |
| Frontend        | Next.js                                                      |
| UI              | Tailwind CSS + shadcn/ui                                     |
| Backend         | Node.js / TypeScript                                         |
| Database        | PostgreSQL + Prisma                                          |
| Background jobs | Redis + BullMQ                                               |
| AI              | Provider-independent LLM adapter (OpenAI, Anthropic, others) |
| Payments        | Razorpay APIs + Webhooks                                     |

## Development Status

- [x] Monorepo structure, pnpm workspace, Turborepo, TypeScript, lint/format
- [x] Database schema (PostgreSQL + Prisma) — `Merchant`, `Order`, `Payment`, `Refund`, `PaymentEvent`, `Settlement`
- [x] Razorpay adapter (payments/orders/refunds, Test Mode, read-only) + webhook signature verification
- [x] Idempotent payment ingestion (API pull + webhook push)
- [x] Read-only payment API (`/health`, `/payments`, `/payments/:id`)
- [ ] Agent runtime and tools
- [ ] Merchant dashboard
- [ ] Financial safety / guardrail system
- [ ] Full audit logging (webhook processing is audited today; there's no agent yet to audit)

### Local Setup

```bash
pnpm install
cp .env.example .env   # fill in Test Mode Razorpay keys + a Postgres DATABASE_URL
pnpm --filter @paysherlock/database run db:migrate:dev
```

Working: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm test` (Razorpay adapter, database layer, and API — run via Turborepo).

`pnpm --filter @paysherlock/api run dev` starts the API on `PORT` (default
`4000`). `pnpm --filter @paysherlock/api run ingest` pulls recent payments
from Razorpay Test Mode into Postgres — safe to run repeatedly, every write
is an idempotent upsert.

Not yet functional: the root `pnpm dev` (no `apps/web` yet — see
[apps/web/README.md](apps/web/README.md)).

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
2. **Phase 1 — Payment Data & Razorpay Foundation** _(current)_: database
   schema, Razorpay adapter (read-only), webhook ingestion, basic API.
3. **Phase 2**: agent runtime, first tools, investigation flow (read-only).
4. **Phase 3**: merchant dashboard, evidence/investigation UI.
5. **Phase 4**: guardrails, approvals, bounded actions, audit logging.
