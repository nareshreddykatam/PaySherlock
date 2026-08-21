# Architecture

Status: Phase 1 — Payment Data & Razorpay Foundation. This covers what
exists today. See [`docs/decisions`](../decisions) for the reasoning behind
these choices, and [`AGENTS.md`](../../AGENTS.md) for the standing
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

## Future agent tool foundation

`packages/database`'s query functions are named and shaped so the future
agent's tools can be thin wrappers over them without a data-layer rewrite:
`listPayments` → `get_payments()`, `getPaymentById`/`getPaymentByRazorpayId`
→ `get_payment_details()`, `listPaymentFailures` → `get_payment_failures()`,
`listOrders` → `get_orders()`, `listRefunds` → `get_refunds()`. No agent
code exists yet — this is a data-layer shape decision only.
