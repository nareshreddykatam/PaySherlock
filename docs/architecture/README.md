# Architecture

Status: Phase 5 — Guarded Recommendations & Actions. This covers what
exists today. See [`docs/decisions`](../decisions) for the reasoning
behind these choices, and [`AGENTS.md`](../../AGENTS.md) for the standing
architecture principles.

## Data flow

```
Razorpay Test Mode
  ├── REST API (payments, orders, refunds — read-only)
  └── Webhooks (POST /webhooks/razorpay)
         │
         ▼
  packages/razorpay          (typed client, signature verification, normalization)
         │
         ▼
  Normalized DTOs             (NormalizedPayment / NormalizedOrder / NormalizedRefund / NormalizedPaymentEvent — packages/types)
         │
         ▼
  packages/database           (idempotent upserts, Prisma / PostgreSQL)
         │
         ▼
  apps/api                    (GET /health, GET /payments, GET /payments/:id)
```

## Package boundaries

- **`packages/razorpay`** — the only place that knows Razorpay's HTTP API,
  auth scheme, or webhook payload shapes. Exposes a typed `RazorpayClient`
  (payments/orders/refunds, read-only in Phase 1), webhook signature
  verification, and normalization functions. Nothing else in the monorepo
  constructs a Razorpay request or parses a raw Razorpay payload.
- **`packages/types`** — the seam between `razorpay` and `database`:
  `NormalizedPayment`/`NormalizedOrder`/`NormalizedRefund`/
  `NormalizedPaymentEvent` are provider-agnostic. `packages/database` never
  imports from `packages/razorpay`.
- **`packages/database`** — Prisma schema, idempotent upsert functions, and
  paginated query functions (`listPayments`, `listPaymentFailures`,
  `listOrders`, `listRefunds`, …). Every function takes a `Database` client
  as a parameter instead of importing a singleton, so it's testable without
  a live Postgres and reusable inside a transaction.
- **`apps/api`** — Fastify HTTP layer. `buildServer(deps)` takes its
  dependencies (`db`, `webhookSecret`) as constructor arguments; routes
  never reach for global state. Also hosts the webhook processing pipeline
  and a manual ingestion CLI (`pnpm --filter @paysherlock/api run ingest`).

## Database schema (Phase 1)

`Merchant`, `Order`, `Payment`, `Refund`, `PaymentEvent`, `Settlement` —
see [`packages/database/prisma/schema.prisma`](../../packages/database/prisma/schema.prisma)
for the authoritative definition. Highlights:

- Every table carries both our internal `id` (cuid) and the external
  Razorpay id (`razorpayPaymentId`, `razorpayOrderId`, …), unique-constrained,
  so upserts are idempotent and safe to re-run.
- `raw: Json` on `Order`/`Payment`/`Refund` preserves the last-seen source
  payload for audit/investigation, without making the typed columns a 1:1
  mirror of Razorpay's response shape (see the normalization ADR).
- `PaymentEvent` is both the webhook idempotency ledger (unique on
  `externalEventId`) and the audit trail of what was received and how it was
  processed (`RECEIVED` → `PROCESSED` / `IGNORED` / `FAILED`).
- `Settlement` exists as schema only — no ingestion or webhook wiring yet
  (see the ADR on MVP webhook event scope).

## Webhook flow

```
POST /webhooks/razorpay
  1. Capture the raw request body (before JSON parsing)
  2. Verify X-Razorpay-Signature (HMAC-SHA256 over the raw body) — reject if invalid
  3. Require x-razorpay-event-id — reject if missing
  4. Parse + schema-validate the JSON body
  5. Normalize into NormalizedPaymentEvent (+ payment/order/refund sub-objects)
  6. Resolve the Merchant (by Razorpay account_id)
  7. Record the event (unique on externalEventId) — duplicate delivery short-circuits here
  8. If the event type is supported: upsert order → payment → refund, mark PROCESSED
     If unsupported: mark IGNORED
     If a step throws: mark FAILED and return 5xx (so Razorpay retries)
```

Steps 1–3 happen before any business data is touched — an invalid signature
or missing event id never reaches the database. See the security ADR for why
raw-body signing and the `x-razorpay-event-id` header specifically.

### Supported webhook events (Phase 1 MVP)

| Event              | Why                                                                                  |
| ------------------ | ------------------------------------------------------------------------------------ |
| `payment.captured` | Payment succeeded — the core "money received" signal.                                |
| `payment.failed`   | Payment failed — needed for failure-rate investigation, PaySherlock's core use case. |
| `order.paid`       | Order-level completion signal; carries both order and payment entities.              |
| `refund.processed` | Refund succeeded.                                                                    |
| `refund.failed`    | Refund failed — also failure-investigation-relevant.                                 |

Any other event type is still signature-verified, recorded (for audit), and
acknowledged with 200 — just not acted on. See the ADR for what's
deliberately excluded (subscriptions, disputes, settlements) and why.

## API endpoints (Phase 1)

| Endpoint                  | Notes                                                                                  |
| ------------------------- | -------------------------------------------------------------------------------------- |
| `GET /health`             | Liveness only — no secrets or infra details.                                           |
| `GET /payments`           | Cursor-paginated (`limit`, `cursor`), normalized response — never raw Razorpay fields. |
| `GET /payments/:id`       | Accepts our internal id or a `pay_`-prefixed Razorpay id.                              |
| `POST /webhooks/razorpay` | See webhook flow above.                                                                |

These exist for PaySherlock's own web app and the future agent's tools —
not as a general-purpose merchant API.

## AI investigation engine (Phase 2)

```
Merchant question
      │
      ▼
POST /investigations (apps/api)          — derives the trusted merchantId server-side
      │
      ▼
packages/agent: runInvestigation()
      │
      ├─▶ provider.plan()                — ONE structured LLM call → objective + tool-call
      │                                     steps + candidate hypothesis ids (validated
      │                                     against the real tool registry/catalog)
      │
      ├─▶ runtime/loop.ts                — executes the plan's steps, bounded by
      │     └─▶ packages/tools               MAX_AGENT_STEPS; every call validated,
      │           └─▶ packages/database       executed, and stored as a structured
      │                 └─▶ Prisma / Postgres ToolResult — never thrown
      │
      ├─▶ evidence/findings.ts           — extracts typed Findings from the ToolResults
      ├─▶ hypotheses/verifier.ts         — deterministic threshold rules → SUPPORTED /
      │                                     REJECTED / INCONCLUSIVE + Evidence[], never
      │                                     an LLM-supplied confidence number
      ├─▶ output/result.ts               — ranks SUPPORTED hypotheses, picks rootCause
      │                                     (or none)
      └─▶ provider.narrate()             — ONE more structured LLM call → summary +
                                             recommendations, phrasing already-decided
                                             facts (never new numbers)
      │
      ▼
InvestigationResult (validated against InvestigationResultSchema)
```

The LLM never touches Postgres, Razorpay credentials, or a financial
action — it only ever sees tool catalogs, structured `ToolResult`s, and
structured facts. See the ADR for why this is two bounded calls rather than
a turn-by-turn tool-calling loop.

### Provider abstraction (`packages/agent/src/provider`)

`LLMProvider` is a 2-method interface (`plan`, `narrate`) implemented by:

- **`DeterministicProvider`** — zero-dependency default; always proposes the
  canonical tool-call sequence and considers every catalog hypothesis. This
  is what the test suite and evaluation harness use, and what the API runs
  with out of the box (no AI credentials required).
- **`AnthropicProvider`** — real provider, a small hand-rolled REST client
  against the Anthropic Messages API (forced tool-use for structured
  output). Selected via `AI_PROVIDER=anthropic` + `AI_MODEL` + `AI_API_KEY`;
  never exercised by automated tests.

`provider/factory.ts::createProvider` selects between them from
configuration — nothing in the agent hard-codes a model name or provider.

### Tool catalog (`packages/tools`)

| Tool                       | Purpose                                                          |
| -------------------------- | ---------------------------------------------------------------- |
| `get_payments`             | Overview: total count/amount + status breakdown.                 |
| `get_payment_failures`     | Failure rate + change vs. baseline, by method/reason/hour.       |
| `compare_periods`          | One metric, current vs. baseline (duration-scaled).              |
| `segment_payments`         | Breakdown by method / status / amount_bucket, optional baseline. |
| `analyze_failure_codes`    | Failure reason codes ranked by share of failures.                |
| `get_refunds`              | Refund count/amount/rate vs. baseline.                           |
| `calculate_revenue_impact` | Deterministic revenue shortfall/surplus estimate.                |

Every tool: validates input and output against zod schemas (`packages/tools`'
`executeTool`), is scoped to `ToolContext.merchantId` (never a model-supplied
field — no tool's input schema even has a merchant field), and returns
compact aggregates computed via `packages/database`'s analytics functions —
never a raw row dump to the model.

### Hypothesis catalog

Fixed, not LLM-invented: `upi_failure_increase`,
`transaction_volume_decline`, `refund_spike`, `payment_method_degradation`,
`high_value_decline` (`packages/agent/src/hypotheses/catalog.ts`). Each has
a dedicated deterministic threshold rule
(`packages/agent/src/hypotheses/rules.ts`) that reads only real tool output.

### API endpoint (Phase 2)

| Endpoint               | Notes                                                                                                                                         |
| ---------------------- | --------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /investigations` | Body: `{ question }`. Merchant is derived server-side (`resolveMerchant`), never from the request. Returns a validated `InvestigationResult`. |

### Evaluation harness

`packages/agent/src/eval/` — 5 required scenarios (UPI degradation, refund
spike, volume decline, high-value decline, normal business) run against a
tiny in-memory fake database (`fakeDatabase.ts`) driven by synthetic,
non-real payment/refund rows. `runEvaluation()` scores root-cause accuracy,
evidence traceability, false-positive rate, tool execution success, invalid
tool-call rate, and average steps — wired into `pnpm test`
(`__tests__/evaluation.test.ts`) and runnable standalone via
`pnpm --filter @paysherlock/agent run eval`.

## Frontend: Investigation Command Center (Phase 3)

```
apps/web (Next.js App Router, Turbopack)
      │
      ├─ app/                page routes: Overview (/), Investigate,
      │                       Payments, Issues, History — each a client
      │                       component driving a typed API call
      │
      ├─ lib/api/             apiFetch() + per-resource client functions
      │                       (investigations, overview, payments) —
      │                       every response is schema-validated before
      │                       the UI ever sees it; NEXT_PUBLIC_API_URL is
      │                       the one configurable base URL
      │
      ├─ lib/history/         sessionStorage-backed investigation history
      │                       (session-only — no server persistence exists)
      │
      ├─ components/          design-system primitives (ui/), layout
      │                       (sidebar/header/shell), and feature
      │                       components (investigation/, payments/,
      │                       issues/, dashboard/)
      │
      └─ app/globals.css      Tailwind v4 @theme tokens — the single
                               source of color/spacing/radius/typography
```

`apps/web` calls exactly three backend surfaces, all schema-validated
against real contracts:

| Endpoint                             | Used by                    | Contract                                                                                                                             |
| ------------------------------------ | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| `GET /overview`                      | Overview, Issues pages     | `OverviewResponseSchema` (`packages/types`)                                                                                          |
| `POST /investigations`               | Investigate, History pages | `InvestigationResultSchema` (`packages/types`)                                                                                       |
| `GET /payments`, `GET /payments/:id` | Payments page              | Frontend-local `PaymentSchema`/`PaymentsPageSchema` (`lib/api/payments.ts`) — see the ADR for why this one isn't in `packages/types` |

### `GET /overview` (new in Phase 3)

```
GET /overview (apps/api)
      │
      ▼
services/overviewService.ts::getOverview
      │
      ├─▶ packages/agent: runDeterministicSnapshot()   — same tool
      │     registry + DEFAULT_INVESTIGATION_STEPS + verifyHypotheses
      │     Phase 2 investigations use, minus provider.plan()/narrate()
      │
      ├─▶ one extra comparePeriodsTool("revenue") call  — for the
      │     Revenue metric card's period-over-period change
      │
      └─▶ maps hypotheses → OverviewIssue[] (severity from status),
          computes successRate/failureRate from snapshot.findings,
          attaches revenueAtRisk only when a rootCause hypothesis exists
          and its estimated impact is positive
      │
      ▼
OverviewResponse (validated against OverviewResponseSchema)
```

This is **not** autonomous monitoring — it runs synchronously inside the
HTTP request, on demand, with no scheduler or persisted detection state.
See the ADR for the full reasoning and for why `hypotheses` was added to
`InvestigationResultSchema` alongside it.

### Design system

Dark-only theme (`color-scheme: dark`, no toggle), defined once as
Tailwind v4 `@theme` CSS variables in `app/globals.css` — canvas/surface
tiers, ink (text) tiers, a sparingly-used emerald accent, amber for
warnings, red for critical. Reusable primitives live in
`components/ui/` (Button/LinkButton, Card, Badge, Input, Skeleton,
StatusDot, EmptyState, ErrorState, Drawer) and are composed by every page
— no page defines its own one-off colors or spacing.

### Investigation UX

`app/investigate/page.tsx` is a small state machine
(`idle → loading → result | error`) around one real `POST /investigations`
call. `ProgressView` labels mirror the backend's actual
`DEFAULT_INVESTIGATION_STEPS` (no fake tool-call streaming); `ResultView`
renders `rootCause`/`confidence`/`businessImpact`/`evidence`/`hypotheses`
exactly as the API returns them — the frontend never computes or alters a
number. See the ADR for the follow-up-as-new-request and session-only
history decisions.

## Proactive Payment Intelligence (Phase 4)

```
Payment Data
      │
      ▼
packages/detection: runDetectors()      — 5 deterministic detectors, no LLM
      │                                    (PAYMENT_FAILURE_SPIKE,
      │                                    PAYMENT_METHOD_DEGRADATION,
      │                                    REFUND_SPIKE,
      │                                    TRANSACTION_VOLUME_DECLINE,
      │                                    HIGH_VALUE_TRANSACTION_DECLINE)
      │
      ▼
DetectionResult[]  (ANOMALY | INSUFFICIENT_DATA, deterministic severity)
      │
      ▼
packages/detection: runDetectionForMerchant()
      │
      ├─▶ fingerprint (type + dimension + UTC day) → find-or-create Issue
      │     — dedup/update, never a duplicate active issue
      │
      ├─▶ severity capped at WARNING on first occurrence; only a
      │     reconfirmed (2nd+ run) issue can reach CRITICAL
      │
      └─▶ for a newly-actionable issue only (storm prevention):
              InvestigationRequest { question, context, timeRange }
                    │
                    ▼
            packages/agent: runInvestigation()   — the EXACT, unmodified
                    │                               Phase 2 engine
                    ▼
            InvestigationResult
                    │
                    ▼
          Issue updated: status, rootCause, confidence,
          estimatedImpactMinorUnits, cached investigationResult
      │
      ▼
apps/api: GET /issues, GET /issues/:id     — merchant-scoped, paginated
      │
      ▼
apps/web: Issues page + /issues/:id detail  — reuses Phase 3's ResultView/
                                                EvidenceList/HypothesisList
      │
      ▼
In-app notification (new issue / severity escalation, deduped per session)
```

Detection and investigation stay two separate responsibilities end to end:
`packages/detection` never imports `@paysherlock/agent`, and
`@paysherlock/agent`'s `runInvestigation` is called exactly as apps/api's
`POST /investigations` already calls it — no second agent, planner, or
hypothesis engine exists in this phase. See the ADR for the full reasoning
behind the baseline methodology, severity/persistence policy, fingerprint
design, and why the orchestration lives in `packages/detection` rather than
`apps/api`.

### Detection package (`packages/detection`)

| Module         | Responsibility                                                                                                                                                                                 |
| -------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `baseline/`    | Comparable time-of-day windows (current + N preceding days) and change statistics.                                                                                                             |
| `severity/`    | Deterministic INFO/WARNING/CRITICAL from magnitude + sample confidence + optional impact.                                                                                                      |
| `fingerprint/` | `type:dimension:dayBucket` dedup key.                                                                                                                                                          |
| `detectors/`   | The five detector implementations — each independently testable.                                                                                                                               |
| `engine/`      | `runDetectors` (orchestrates all five) and `detectionRun.ts::runDetectionForMerchant` (the detect → issue → investigate pipeline, shared by apps/api's eval harness and workers/investigator). |

### Issue model and lifecycle

`Issue` (`packages/database/prisma/schema.prisma`) persists a detected
anomaly and, once investigated, the triggering investigation's outcome —
see the ADR for the full schema rationale. Lifecycle:

```
DETECTED → INVESTIGATING → IDENTIFIED
                          → MONITORING        (investigated, no root cause found)
         → INVESTIGATION_FAILED → INVESTIGATING (retried by a later run)
active status* → RESOLVED   (auto: not reconfirmed within the staleness window)
active status* → DISMISSED  (merchant-initiated, via dismissIssue)
```

\* any non-terminal status. Uniqueness among _active_ issues per
`(merchantId, fingerprint)` is enforced in application code
(`findActiveIssueByFingerprint`), not a DB constraint — a resolved/dismissed
issue never blocks a fresh one from being created later under the same
fingerprint.

### Detection worker (`workers/investigator`)

```
pnpm --filter @paysherlock/investigator-worker run detect   — runs once, exits (manual/demo)
pnpm --filter @paysherlock/investigator-worker run start    — runs immediately, then every
                                                                DETECTION_INTERVAL_MS (default 15 min)
```

Resolves the single MVP merchant, builds an investigation runner the same
way `apps/api`'s entrypoint does, and calls `runDetectionForMerchant` — a
plain `setInterval` loop, no BullMQ/Redis/cloud scheduler.

### API endpoints (Phase 4)

| Endpoint          | Notes                                                                                                                           |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------- |
| `GET /issues`     | Merchant-scoped, cursor-paginated, newest-detected-first.                                                                       |
| `GET /issues/:id` | Merchant-scoped lookup (`findFirst({id, merchantId})`, never a bare id lookup) — 404 if not found or owned by another merchant. |

### Evaluation harness

`apps/api/src/eval/` — the 8 required Phase 4 scenarios (A–H), run
end-to-end against the real (unmodified) Phase 2 investigation engine and a
synthetic in-memory database (`apps/api/src/eval/fakeDatabase.ts`, which
extends `@paysherlock/agent`'s exported fake payment/refund database with a
fake `issue` table). Scores detection recall, false-positive rate,
duplicate-issue rate, investigation-trigger success, and root-cause
accuracy — wired into `pnpm test` and runnable standalone via
`pnpm --filter @paysherlock/api run eval:phase4`. Labeled explicitly as
controlled synthetic evaluation, not real-world accuracy (brief section 36).

## Guarded recommendations & actions (Phase 5)

```
Completed investigation (targetPaymentId set)
      │
      ▼
generateRecommendationForInvestigation (apps/api)
      │
      ├─▶ generateRefundRecommendationCandidate / generateNoActionCandidate
      │     (packages/actions) — pure functions, no persistence
      │
      ├─▶ validateRecommendationCandidate (packages/actions)  — re-checks
      │     type/payment-ownership/amount/eligibility against real,
      │     currently-persisted state, regardless of where the candidate
      │     came from
      │
      ├─▶ determineRiskLevel (packages/actions)  — deterministic, amount-based
      │
      ▼
Recommendation (PENDING_APPROVAL for REFUND_PAYMENT, already-terminal
SUCCEEDED for NO_ACTION) — persisted, audited (RECOMMENDATION_CREATED)
      │
      ▼
Merchant: POST /recommendations/:id/approve  (explicit, no request body)
      │
      ▼
approveRecommendation (atomic conditional UPDATE — see docs/decisions)
      │
      ├─▶ createAction (idempotencyKey = paysherlock-refund-<recommendationId>)
      ├─▶ audit: RECOMMENDATION_APPROVED
      │
      ▼
runExecution (apps/api) — APPROVED → EXECUTING
      │
      ├─▶ audit: ACTION_STARTED
      ├─▶ executeRefund (packages/actions)
      │     ├─▶ razorpayClient.payments.fetch()      — live state, never cached
      │     ├─▶ validateRefundEligibility()           — re-checked against live state
      │     ├─▶ razorpayClient.refunds.create()        — packages/razorpay, Test Mode
      │     └─▶ razorpayClient.refunds.fetch()         — verify before claiming success
      │
      ▼
SUCCEEDED (audit: ACTION_SUCCEEDED) | FAILED (audit: ACTION_FAILED, safe error)
```

A `FAILED` recommendation can be retried (`POST /recommendations/:id/retry`)
— this re-enters `runExecution` reusing the _same_ `Action` row and
`idempotencyKey`, never a new logical action.

### Recommendation / Action data model

| Model            | Owns                                                                                                                                                                                                |
| ---------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `Recommendation` | The narrative + decision: type, title, LLM-influenced explanation, riskLevel, status, target payment/amount/currency, approval/rejection/expiry timestamps.                                         |
| `Action`         | The execution mechanics: idempotencyKey, providerReference/providerStatus, errorCode/errorMessage, started/completed timestamps. One-to-one with a `Recommendation`, created only at approval time. |
| `AuditEvent`     | Append-only log of `RECOMMENDATION_{CREATED,APPROVED,REJECTED}` / `ACTION_{STARTED,SUCCEEDED,FAILED}`, with safe structured metadata only.                                                          |

See [docs/decisions/0005](../decisions/0005-guarded-actions.md) for why
these are two models (not one) and the full state-machine/idempotency
reasoning.

### API endpoints (Phase 5)

| Endpoint                            | Notes                                                                                     |
| ----------------------------------- | ----------------------------------------------------------------------------------------- |
| `GET /recommendations`              | Merchant-scoped, cursor-paginated, newest-first, includes the linked `Action` if present. |
| `GET /recommendations/:id`          | Merchant-scoped lookup — 404 if not found or owned by another merchant.                   |
| `POST /recommendations/:id/approve` | No request body. Approves and, in the same call, executes. 409 if not pending/expired.    |
| `POST /recommendations/:id/reject`  | No request body. 409 if not pending.                                                      |
| `POST /recommendations/:id/retry`   | No request body. Only valid from `FAILED`; reuses the existing `Action`.                  |
| `GET /actions/:id`                  | Merchant-scoped lookup of the execution record.                                           |
| `POST /investigations`              | Now accepts optional `targetPaymentId`; response includes `recommendation` (nullable).    |

### Razorpay adapter (extended)

`packages/razorpay`'s `RazorpayClient` gained `refunds.create(paymentId,
body, idempotencyKey)` — `POST /payments/:id/refund` with the
`X-Refund-Idempotency` header — the one write operation this phase adds.
Same class, same auth/response-validation pattern as every read method
Phase 1 built; no second HTTP client.

### Evaluation

`apps/api/src/__tests__/phase5Evaluation.test.ts` — the 8 required
scenarios (A–H: valid refund, already-refunded, over-limit amount, double
approval, provider failure, expired recommendation, merchant isolation,
retry), run against `apps/api/src/eval/fakeDatabasePhase5.ts` (a
synthetic in-memory `payment`/`recommendation`/`action`/`auditEvent`
store) and a mocked `RazorpayClient`. Expressed as behavioral pass/fail
scenarios rather than a scored-metrics harness — see docs/decisions for
why that fits Phase 5 better than Phase 4's rate-based approach.

## Future agent tool foundation → now implemented

Phase 1 named the future tool shapes (`get_payments()`,
`get_payment_failures()`, etc.) against `packages/database`'s query
functions. Phase 2 implements them for real in `packages/tools`, backed by
new atomic analytics functions in `packages/database/src/analytics/`
(`getPaymentAggregate`, `getPaymentStatusBreakdown`,
`getPaymentMethodStatusBreakdown`, `getFailureCodeBreakdown`,
`getPaymentTimestamps`, `getPaymentAmounts`, `getRefundAggregate`) — no
second database layer, no raw Prisma calls scattered through tools.
