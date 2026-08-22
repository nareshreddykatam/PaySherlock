# PaySherlock

**AI Payment Intelligence & Investigation Agent**

> Built for the Razorpay Buildathon — Open Track

## Status: Phase 6 — Evaluation, Reliability & Buildathon Polish

Phase 0 (monorepo tooling), Phase 1 (Razorpay Test Mode integration,
normalized payment data), Phase 2 (the AI investigation engine), Phase 3
(the Investigation Command Center frontend), Phase 4 (deterministic
proactive detection — `packages/detection`, persisted `Issue` records,
automatic investigation triggering), and Phase 5 (the first guarded
financial action: a merchant-approved refund) are complete. Phase 6 adds
no new financial action and no new product surface — it hardens
reliability/security (including a real cross-merchant payment-lookup gap
found and fixed during this phase's audit — see
[docs/buildathon/SAFETY.md](docs/buildathon/SAFETY.md)), adds request
timeouts and correlation ids, adds a 12-scenario end-to-end evaluation
harness, and adds Buildathon demo/documentation. The architecture is
strict and one-directional — `AI → Recommendation → deterministic
validation → risk policy → merchant approval → action executor →
Razorpay → verification → audit record` — and the LLM **never** executes a
financial action or calls Razorpay directly; it only ever supplies
explanatory text. **Bulk refunds, payment capture, payment links,
settlement operations, and any automatic/unapproved execution are not
implemented and are explicitly out of scope.** See
[Development Status](#development-status) below,
[docs/architecture](docs/architecture), and
[docs/buildathon](docs/buildathon) (judge-facing overview, architecture,
demo script, evaluation results, safety guarantees) for details.

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
packages/detection    Deterministic anomaly detection engine
packages/actions      Guarded recommendation/approval/action executor
packages/razorpay    Razorpay integration adapter
packages/database    Database client/schema layer
packages/types        Shared TypeScript types
packages/ui           Shared UI components
workers/investigator  Background detection/investigation worker
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
| Background jobs | Plain `setInterval` scheduler (`workers/investigator`) — no Redis/BullMQ   |
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
- [x] Deterministic anomaly detection — 5 detectors (`packages/detection`),
      zero LLM involvement, persisted as `Issue` records with a
      dedup/lifecycle model (`GET /issues`, `GET /issues/:id`)
- [x] Automatic investigation triggering — a detected anomaly hands off to
      the existing Phase 2 engine (no second agent), with storm prevention
      and safe failure handling
- [x] Detection worker (`workers/investigator`) — scheduled (`run start`)
      or manual (`run detect`) invocation
- [x] In-app issue notifications (new/escalated only, deduped per session —
      no email/Slack/SMS)
- [x] Guarded recommendations (`packages/actions`) — `REFUND_PAYMENT` and
      `NO_ACTION`, deterministic risk policy (LOW/MEDIUM/HIGH), server-side
      eligibility validation, bounded expiration
- [x] Mandatory merchant approval — every financial action requires an
      explicit `POST /recommendations/:id/approve`; no code path (agent,
      worker, detector, frontend) can execute one without it
- [x] Refund executor (`packages/actions`) — extends the existing
      `packages/razorpay` adapter (no second HTTP client), re-validates
      against Razorpay's _live_ payment state immediately before executing,
      verifies the created refund before ever reporting success
- [x] Deterministic idempotency (`paysherlock-refund-<recommendationId>`)
      and database-level double-approval protection (atomic conditional
      updates) — a retry or a race can never create two refunds
- [x] Append-only audit trail (`AuditEvent`) — recommendation
      created/approved/rejected, action started/succeeded/failed
- [x] Recommendation/Action API (`GET/POST /recommendations*`,
      `GET /actions/:id`), all merchant-scoped server-side
- [x] Frontend: recommendation card with an explicit confirmation dialog
      ("Confirm Refund", never "OK"/"Continue"), success/failure states,
      and a real recommendation-history page (`/recommendations`)
- [x] Request timeouts on every outbound call (`RazorpayClient` 10s,
      `AnthropicProvider` 30s via `AbortController`) — nothing can hang
      indefinitely
- [x] `Action` state-machine guard (conditional `updateMany`, matching
      `Issue`/`Recommendation`) — an invalid transition like
      `SUCCEEDED → EXECUTING` returns null rather than corrupting state
- [x] Fixed a real cross-merchant IDOR gap: `GET /payments` and
      `GET /payments/:id` are now merchant-scoped like every other route
      (found during the Phase 6 security audit)
- [x] Request correlation (`X-Request-Id`, echoed and logged on every
      request)
- [x] Detection worker scheduler hardening — no overlapping detection
      runs, clean shutdown
- [x] 12-scenario Phase 6 end-to-end evaluation harness
      (`pnpm --filter @paysherlock/api run eval:phase6`) — generates
      [docs/evaluation/phase6-report.md](docs/evaluation/phase6-report.md)
- [x] Buildathon demo mode (`workers/investigator/src/demo/` —
      `demo:seed`/`demo:run`/`demo:reset`) and documentation
      ([docs/buildathon](docs/buildathon))
- [ ] Bulk refunds, payment capture, payment links, settlement operations
- [ ] Merchant approval _workflows_ beyond single-click approve/reject (e.g.
      multi-approver), production authentication, real (non-in-app)
      notifications

### Local Setup

```bash
pnpm install
cp .env.example .env   # fill in Test Mode Razorpay keys + a Postgres DATABASE_URL
pnpm --filter @paysherlock/database run db:migrate:dev
```

Working: `pnpm build`, `pnpm lint`, `pnpm typecheck`, `pnpm format:check`,
`pnpm test` (364 tests across the Razorpay adapter, database layer, tools,
agent, detection engine, actions/recommendation layer, API, web frontend,
and detection worker — run via Turborepo, no AI credentials, live
database, or live Razorpay credentials required). The Phase 5 evaluation
scenarios (A–H:
valid refund, already-refunded, over-limit amount, double approval,
provider failure, expired recommendation, merchant isolation, retry) run
as part of `pnpm --filter @paysherlock/api run test`
(`src/__tests__/phase5Evaluation.test.ts`) against a synthetic in-memory
database and a mocked Razorpay client — never live credentials. The
Phase 6 evaluation scenarios (A–L: the full detection → investigation →
recommendation → approval → action → verification → audit lifecycle,
plus cross-merchant isolation) run the same way
(`src/__tests__/phase6Evaluation.test.ts`) and are also runnable
standalone via `pnpm --filter @paysherlock/api run eval:phase6`, which
generates [docs/evaluation/phase6-report.md](docs/evaluation/phase6-report.md).

`pnpm --filter @paysherlock/api run dev` starts the API on `PORT` (default
`4000`) — by default with `AI_PROVIDER=deterministic`, so `POST
/investigations` works with no AI credentials at all. Set
`AI_PROVIDER=anthropic` + `AI_MODEL` + `AI_API_KEY` to use a real model.
`pnpm --filter @paysherlock/api run ingest` pulls recent payments from
Razorpay Test Mode into Postgres — safe to run repeatedly, every write is
an idempotent upsert. `pnpm --filter @paysherlock/agent run eval` runs the
Phase 2 5-scenario evaluation harness standalone; `pnpm --filter
@paysherlock/api run eval:phase4` runs the Phase 4 8-scenario proactive-flow
harness (detection → issue → real investigation → root cause) standalone.

`pnpm --filter @paysherlock/web dev` starts the frontend on
`http://localhost:3000` (set `NEXT_PUBLIC_API_URL` in
`apps/web/.env.local` if the API isn't on the default `http://localhost:4000`
— see [apps/web/README.md](apps/web/README.md)).

`pnpm --filter @paysherlock/investigator-worker run detect` runs the
detection engine once for the merchant and exits — the fastest way to see
an issue appear without waiting for the schedule. `pnpm --filter
@paysherlock/investigator-worker run start` runs it immediately, then every
`DETECTION_INTERVAL_MS` (default 15 minutes, configurable) until stopped.

For a Buildathon walkthrough: `pnpm --filter @paysherlock/investigator-worker
run demo:seed` seeds a deterministic "UPI degradation" scenario against one
dedicated example merchant ("PaySherlock Demo Merchant"), `run demo:run`
triggers detection immediately (no waiting on the interval) and prints the
resulting issue/investigation, and `run demo:reset` deletes and re-seeds
only that merchant's data. Full script in
[docs/buildathon/DEMO.md](docs/buildathon/DEMO.md).

## Security Note

This project handles financial data and payment provider credentials.
Razorpay is used in **Test Mode only** — never live/production credentials
(the Phase 5 refund executor has no code-level "live vs. test" switch of
its own; this is an operational/credential discipline, enforced by which
`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` are configured, not by the code).
Secrets are never committed — see `.env.example` for the required
environment variables and `AGENTS.md` for the full security and
financial-safety requirements. All Razorpay API calls happen server-side;
webhook signatures are verified before any data is processed. **No
AI-initiated financial action ever executes without an explicit merchant
approval step** — `POST /recommendations/:id/approve` is the only code
path that can reach Razorpay's refund endpoint; see
[docs/decisions/0005](docs/decisions/0005-guarded-actions.md) for the full
trace and the tests that verify no bypass exists.

## Roadmap

1. **Phase 0 — Foundation** _(done)_: monorepo, tooling, conventions.
2. **Phase 1 — Payment Data & Razorpay Foundation** _(done)_: database
   schema, Razorpay adapter (read-only), webhook ingestion, basic API.
3. **Phase 2 — AI Investigation Engine** _(done)_: agent runtime, tools,
   bounded investigation loop, evidence-backed results (read-only).
4. **Phase 3 — Investigation Command Center** _(done)_: merchant
   frontend, real evidence/hypothesis/investigation UI, `GET /overview`.
5. **Phase 4 — Proactive Payment Intelligence** _(done)_: deterministic
   anomaly detection, persisted issues, automatic (existing-engine)
   investigation triggering, detection worker, in-app notifications.
6. **Phase 5 — Guarded Recommendations & Actions** _(done)_: a
   deterministically-validated, merchant-approved refund action — the
   first (and, for now, only) real financial action, with full
   idempotency, audit trail, and stale-state re-validation.
7. **Phase 6 — Evaluation, Reliability & Buildathon Polish** _(current)_:
   no new financial action or product surface. A 12-scenario end-to-end
   evaluation harness; reliability hardening (request timeouts, an
   `Action` state-machine guard, detection-scheduler overlap prevention,
   a notification-timer leak fix); a real cross-merchant payment-lookup
   security gap found and fixed; request correlation ids; a deterministic
   Buildathon demo mode; and Buildathon documentation
   ([docs/buildathon](docs/buildathon)).
