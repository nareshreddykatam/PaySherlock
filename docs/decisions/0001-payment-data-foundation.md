# 0001 — Payment Data & Razorpay Foundation

Status: Accepted (Phase 1)

This records the non-obvious decisions made building the Razorpay
integration and payment data layer, and why. See
[`docs/architecture`](../architecture) for what was built.

## Money as integer minor units, no floats

Every amount column (`Payment.amount`, `Order.amountPaid`, `Refund.amount`,
…) is a Postgres `Int` storing paise — the same integer minor-unit
representation Razorpay's API already uses. We never convert to rupees or a
floating-point value internally.

**Why:** floating-point money is a well-known correctness hazard (rounding
drift in aggregates). Razorpay already hands us integers; storing anything
else would mean a lossy conversion on the way in and another on the way out,
for no benefit. `Int` (32-bit) caps a single row at ~₹21.4M, which is well
beyond a single transaction's realistic range for this MVP; if a future
aggregate needs more headroom, `SUM()` in Postgres widens automatically, and
individual-row storage can move to `BigInt` without a data model rethink.

## Normalized schema, not a raw copy of Razorpay's API

`Payment`, `Order`, and `Refund` have their own typed columns
(`status`, `method`, `captured`, …) derived from Razorpay's fields, not a
JSON blob of the API response as the primary representation. A `raw: Json`
column preserves the last-seen source payload alongside the typed columns,
for audit/investigation — but nothing queries against it as the source of
truth.

**Why:** the future AI agent and any query code should reason in
PaySherlock's own vocabulary, not Razorpay's. It also means a Razorpay field
rename/addition doesn't ripple through every consumer — only
`packages/razorpay`'s normalization functions need to change.

## Webhook signature verification: raw body, HMAC-SHA256, `X-Razorpay-Signature`

Per Razorpay's current documentation
([razorpay.com/docs/webhooks/validate-test](https://razorpay.com/docs/webhooks/validate-test/)),
the signature is `hmac_sha256(raw_request_body, webhook_secret)`, sent in the
`X-Razorpay-Signature` header, and **must** be computed over the exact raw
bytes Razorpay sent — not a re-serialized `JSON.stringify(parsedBody)`.

**How we implemented this:** Fastify's default JSON body parser discards the
raw string once it parses the body. `apps/api/src/plugins/rawBody.ts`
replaces it with a parser that captures the raw string on the request
_before_ parsing, so the webhook route can verify against the untouched
bytes. Signature verification happens before the body is parsed for routing
purposes, and before any database write.

## Webhook idempotency: `x-razorpay-event-id`, not a derived key

Razorpay's webhook FAQs document that `x-razorpay-event-id` is "unique per
event" and state Razorpay uses at-least-once delivery with retries — so a
webhook handler must tolerate (and dedupe) repeat deliveries. We use that
header value directly as `PaymentEvent.externalEventId` (unique-constrained)
rather than deriving a synthetic key from the payload (e.g.
`event + resource_id + created_at`), which is both simpler and matches what
Razorpay itself documents as the deduplication mechanism.

**Consequence:** a request missing this header is rejected (400) rather than
processed without a dedup guarantee — we'd rather fail loudly than silently
risk double-processing.

## Hand-rolled REST client instead of the official `razorpay` SDK

`packages/razorpay`'s `RazorpayClient` uses Node's native `fetch` with a
manually-built Basic Auth header, rather than the official `razorpay` npm
package.

**Why:** it keeps the dependency surface minimal, and — more importantly —
gives us full control over typed request/response shapes validated with zod,
which is what makes the "malformed response" test scenarios meaningful. The
official SDK remains a drop-in future replacement if its surface area proves
worth the dependency, since everything is isolated behind
`packages/razorpay`'s public API — nothing outside that package would need
to change.

## Settlement: schema only, no ingestion/webhook wiring yet

`Settlement` exists in the Prisma schema (per the Phase 1 brief's minimum
model list) but has no client method, no ingestion path, and isn't part of
the supported webhook event set.

**Why:** the MVP webhook event set is scoped to what PaySherlock's core
use case (investigating payment success/failure/refunds) actually needs.
Settlement reconciliation is a distinct feature with its own event set and
UX; adding a client method and ingestion path with nothing calling them
would be exactly the "unused API wrapper" the brief said to avoid. The
schema exists so a future settlements feature is additive, not a migration.

## Refund arriving before its payment: fail loudly, don't relax the FK

`Refund.paymentId` is a required foreign key. If a `refund.processed`
webhook arrives referencing a payment PaySherlock hasn't ingested yet,
`upsertRefund` throws `NotFoundError` rather than creating an orphaned or
nullable-FK row.

**Why:** in practice this shouldn't happen — Razorpay sends `refund.*`
webhooks with the associated `payment` entity in the same payload, which we
upsert first (see the webhook flow in the architecture doc). The guard
exists for true out-of-order delivery; when it fires, the webhook event is
recorded and marked `FAILED` (visible for investigation) and Razorpay's
retry policy gives it another chance once the payment exists. We chose
"loud failure, retryable" over silently dropping the refund or weakening the
schema's integrity guarantee.

## Database tests use a mocked Prisma client, not a live Postgres

There is no Postgres available in this environment (no Docker), and Phase 1
didn't call for provisioning cloud infrastructure. Every `packages/database`
query/upsert function accepts its `Database` client (`PrismaClient |
Prisma.TransactionClient`) as a parameter rather than importing a singleton,
specifically so unit tests can inject a mock and assert on the Prisma calls
made (correct `where`/`create`/`update` shape, unique-constraint-violation
handling for dedup, etc.) without a database connection.

**Limitation:** these are unit tests of our query-construction and
control-flow logic, not integration tests against real Postgres constraints
(actual unique-index enforcement, actual transaction semantics). Running
`prisma migrate dev` against a real (even local/throwaway) Postgres instance
and adding integration tests is the natural next step once one is available
— the schema and migration tooling are already in place for it
(`pnpm --filter @paysherlock/database run db:migrate:dev`).

## Single-tenant `Merchant`, resolved by Razorpay `account_id`

PaySherlock is single-tenant for this MVP (one connected Razorpay account),
but every payment-related row still carries a `merchantId`. `resolveMerchant`
upserts by `razorpayAccountId` (from the webhook payload's `account_id`)
when known, falling back to a single default `Merchant` row otherwise (e.g.
during manual API-based ingestion, which doesn't carry `account_id`).

**Why:** this avoids a schema migration when multi-merchant support is
added later, at the cost of one extra lookup/upsert per webhook — a
worthwhile trade for a foundation phase.
