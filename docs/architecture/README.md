# Architecture

Status: Phase 2 — AI Investigation Engine. This covers what exists today.
See [`docs/decisions`](../decisions) for the reasoning behind these
choices, and [`AGENTS.md`](../../AGENTS.md) for the standing architecture
principles.

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

## Future agent tool foundation → now implemented

Phase 1 named the future tool shapes (`get_payments()`,
`get_payment_failures()`, etc.) against `packages/database`'s query
functions. Phase 2 implements them for real in `packages/tools`, backed by
new atomic analytics functions in `packages/database/src/analytics/`
(`getPaymentAggregate`, `getPaymentStatusBreakdown`,
`getPaymentMethodStatusBreakdown`, `getFailureCodeBreakdown`,
`getPaymentTimestamps`, `getPaymentAmounts`, `getRefundAggregate`) — no
second database layer, no raw Prisma calls scattered through tools.
