# PaySherlock

**AI Payment Intelligence & Investigation Agent**

> Built for the Razorpay Buildathon — Open Track

## Status: Phase 0 — Foundation

This repository currently contains only the project foundation (monorepo
tooling, structure, and conventions). **No product features are implemented
yet** — no payment integration, no AI investigation logic, no dashboard, no
database models. See [Development Status](#development-status) below.

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
- [ ] Database schema
- [ ] Razorpay adapter
- [ ] Agent runtime and tools
- [ ] Merchant dashboard
- [ ] Financial safety / guardrail system
- [ ] Audit logging

### Local Setup

```bash
pnpm install
```

Working now: `pnpm build`, `pnpm lint`, `pnpm typecheck` (run across the
placeholder packages via Turborepo).

Not yet functional: `pnpm dev` (no app currently defines a `dev` script) and
`pnpm test` (no test suites exist yet). Both are wired up at the root and
will activate automatically once packages implement the corresponding
scripts.

## Security Note

This project handles financial data and, eventually, payment provider
credentials. Secrets are never committed — see `.env.example` for the
required environment variables and `AGENTS.md` for the full security and
financial-safety requirements. No AI-initiated financial action will ever
execute without an explicit merchant approval step.

## Roadmap

1. **Phase 0 — Foundation** _(current)_: monorepo, tooling, conventions.
2. **Phase 1**: database schema, Razorpay adapter (read-only), basic API.
3. **Phase 2**: agent runtime, first tools, investigation flow (read-only).
4. **Phase 3**: merchant dashboard, evidence/investigation UI.
5. **Phase 4**: guardrails, approvals, bounded actions, audit logging.
