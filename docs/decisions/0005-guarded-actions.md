# 0005 — Guarded Recommendations & Actions

Status: Accepted (Phase 5)

This records the non-obvious decisions made building the
recommendation/approval/execution layer (`packages/actions`, the
`Recommendation`/`Action`/`AuditEvent` models, and the extended
`packages/razorpay` adapter) — and why. See
[`docs/architecture`](../architecture) for what was built.

## The hard rule, and how it's actually enforced in code

> AI → Recommendation → deterministic validation → risk policy → merchant
> approval → action executor → Razorpay → verification → audit record.

This isn't just a diagram — it's a literal call-graph property. There is
exactly one function in the entire codebase that ever calls
`RazorpayClient.refunds.create`:
`packages/actions/src/refund/executeRefund.ts::executeRefund`. It is only
ever reachable from `apps/api/src/services/recommendationService.ts`'s
`runExecution`, which is only ever called from `approveRecommendationAndExecute`
(itself only reachable after `approveRecommendation` returns a real
`PENDING_APPROVAL → APPROVED` transition) or `retryRecommendationExecution`
(only reachable from `FAILED`). No detector, no worker, no agent code, and
no frontend code holds a `RazorpayClient` reference at all — `apps/api`'s
entrypoint (`src/index.ts`) is the only place one is constructed, and it's
injected into `ServerDeps` only for the three recommendation-service
callbacks. `packages/actions` and `packages/detection` both have zero
dependency on `@paysherlock/agent`, so there is no path from "the LLM
decided something" to "money moved" that skips the approval endpoint.

## Recommendation vs. Action: two rows, not one duplicated model

The brief's own Recommendation and Action field lists overlap heavily
(both have a notion of "status"). Rather than pick one model and stretch
it, or duplicate every field onto both:

- **`Recommendation`** owns the _narrative and decision_: what's being
  proposed, why (LLM-influenced `explanation`), how risky, and what the
  merchant decided (`PENDING_APPROVAL → APPROVED | REJECTED | EXPIRED`,
  then `EXECUTING → SUCCEEDED | FAILED`).
- **`Action`** owns the _execution mechanics_, and only ever exists once a
  recommendation has been approved: `idempotencyKey`, `providerReference`/
  `providerStatus`, `errorCode`/`errorMessage`, `startedAt`/`completedAt`.
  Its own status enum (`APPROVED | EXECUTING | SUCCEEDED | FAILED`) is
  deliberately narrower than `Recommendation`'s — it has no
  `PENDING_APPROVAL`/`REJECTED`/`EXPIRED` states, because those can never
  apply to a row that only exists after approval.

`Action.recommendationId` is `@unique` (one Action per Recommendation,
ever) and both statuses are always advanced together, in the same
service-layer sequence (`recommendationService.ts::runExecution`) — they
never drift independently. This satisfies "don't duplicate the
recommendation model unnecessarily" while still giving the brief's
Action-specific fields (idempotency key, provider reference, timestamps) a
home that isn't crowded onto the recommendation's own narrative fields.

## Idempotency key: derived from the _recommendation's_ id, not the action's

The brief's example key format is `paysherlock:refund:<action-id>`. Using
the Action's own id would require creating the Action row before knowing
its own key (or a create-then-update round trip). Since `Action` is 1:1
with `Recommendation`, the recommendation's id is an equally stable
identity for "this logical refund" — so
`packages/actions/src/registry/actionTypes.ts::buildRefundIdempotencyKey`
takes the **recommendation id**: `paysherlock-refund-<recommendationId>`.
It's computed once, at `Action` creation (right after approval), and
reused verbatim on every retry — never regenerated. `Action.idempotencyKey`
is also `@unique` at the database level, as a second guarantee alongside
the "one Action per Recommendation" uniqueness.

## Double-approval protection: one atomic conditional UPDATE, not a lock

`packages/database/src/upsert/recommendation.ts::approveRecommendation`
does:

```sql
UPDATE recommendations
SET status = 'APPROVED', approved_at = now()
WHERE id = $1 AND merchant_id = $2 AND status = 'PENDING_APPROVAL'
  AND (expires_at IS NULL OR expires_at > now())
```

(expressed as Prisma's `updateMany` with that `where` clause) — a single
atomic statement. Two concurrent approval requests both racing to run this
can only ever have one of them actually flip a row (Postgres serializes
the two UPDATEs; whichever commits first moves `status` away from
`PENDING_APPROVAL`, so the second's `WHERE` clause matches zero rows). The
loser gets `{outcome: "conflict"}` and the caller returns HTTP 409 — never
a second execution. This needed no explicit transaction, lock, or
`SELECT ... FOR UPDATE`: the conditional `UPDATE` _is_ the atomicity
primitive, the same pattern `beginRecommendationExecution` (for
`APPROVED → EXECUTING` and the `FAILED → EXECUTING` retry path) and
`rejectRecommendation` reuse. This is verified directly (not just assumed)
in `apps/api/src/__tests__/phase5Evaluation.test.ts`'s scenario D, which
fires two concurrent `approveRecommendationAndExecute` calls and asserts
exactly one execution and one Razorpay call.

## Stale-state protection: re-validate against Razorpay's _live_ state, always

A recommendation's `amountMinorUnits` is fixed at generation time from the
payment's refundable amount _then_. By the time a merchant approves it,
another refund (or a webhook-driven update) may have changed that. Rather
than trust the persisted recommendation or the frontend's displayed
number, `executeRefund` always calls `razorpayClient.payments.fetch(...)`
immediately before constructing the refund request and re-runs the exact
same `validateRefundEligibility` check against that live response. If the
live state shows the payment already fully refunded, or the requested
amount now exceeds what's refundable, execution is blocked with
`NOT_ELIGIBLE` and **no** `refunds.create` call is made at all — this is
scenarios B and C in the evaluation suite.

## Verification: never trust the create response alone

After `refunds.create` returns, `executeRefund` re-fetches the refund via
`refunds.fetch(refund.id)` before ever reporting success. If that
re-fetch fails (network blip, transient error) the refund may genuinely
have been created — its id is preserved in the failure result
(`providerReference`) for an operator to look up manually — but the
function still reports `success: false`, never a guessed success. If
either the create response or the verification fetch reports
`status: "failed"`, that's also treated as a failure, never success.

## Razorpay adapter extension: one new write method, the documented header

`packages/razorpay/src/client.ts` gained a private `post<T>()` (mirroring
the existing `get<T>()`) and `refunds.create(paymentId, body,
idempotencyKey)` — `POST /v1/payments/:id/refund`. The idempotency header
name and constraint (`X-Refund-Idempotency`, ≥10 characters,
alphanumeric/hyphen/underscore only) come directly from Razorpay's own
documentation (razorpay.com/docs/api/refunds/normal-refunds-idempotent),
not guessed — the client validates a key against that pattern itself
(`RazorpayInvalidIdempotencyKeyError`) before ever sending a request, as a
defensive check independent of whatever `packages/actions` supplies. No
second HTTP client was created; this is the same `RazorpayClient` class
Phase 1 built, extended in place.

## Risk policy: a small, documented, amount-based threshold

`packages/actions/src/policy/riskPolicy.ts::determineRiskLevel` is a pure
function: `NO_ACTION` is always `LOW`; any real refund is at least
`MEDIUM`, escalating to `HIGH` at ₹50,000 (5,000,000 paise) or above — a
deliberately conservative, documented judgment call (not statistically
derived), matching the same "MVP threshold, not tuned on real merchant
data" spirit as Phase 4's detector thresholds. The LLM's `explanation`
text never influences this number.

## What actually generates a recommendation, and what deliberately doesn't

The brief's own Issue-integration example ("Issue: Duplicate payment
detected → Recommendation: Refund ₹2,400") describes a scenario none of
Phase 4's five detectors can produce — they're all merchant-wide or
per-method aggregates (failure rate, refund rate, transaction volume,
high-value count), never a pointer to one specific payment. Inventing
"which payment" from an aggregate anomaly would mean guessing, which this
phase explicitly refuses to do.

Instead, recommendation generation is wired to the one place a specific
payment is actually known: `InvestigationRequest.targetPaymentId` (new,
optional, additive field — the same non-breaking pattern Phase 3 used for
`hypotheses`), set when a merchant investigates a specific payment (the
Payments page's "Investigate this payment" link now also carries the
payment's internal id). `apps/api/src/routes/investigations.ts` always
calls `generateRecommendationForInvestigation` after a completed
investigation:

- **Root cause found + a still-refundable target payment** → a
  `REFUND_PAYMENT` candidate for the payment's exact current refundable
  amount (never a merchant-supplied or LLM-supplied number), which is then
  independently re-validated by `validateRecommendationCandidate` before
  persistence — even though it was code-generated, not literally an LLM's
  JSON, it goes through the same untrusted-input pipeline the brief
  describes, so a future free-form model output could plug into the exact
  same seam without a new validation path.
- **Everything else** (no root cause, no target payment, target payment
  not eligible/not owned by this merchant) → a `NO_ACTION` candidate,
  created directly in a terminal `SUCCEEDED` state (nothing to approve).

Every completed investigation therefore always gets exactly one
recommendation — this is what powers a real, backend-driven
`GET /recommendations` history (Phase 5 brief section 34) without a second
"investigation log" table: NO_ACTION rows are the "nothing to do, but we
looked" entries, REFUND_PAYMENT rows are the actionable ones.

**Known scope boundary:** Phase 4's automatically-triggered investigations
(from the detection worker) do not currently generate recommendations —
`Issue.recommendations` exists as a schema relation for a
merchant-initiated investigation that happens to reference an issue, but
nothing in this phase auto-populates it from the worker's flow, for the
reason above. Documented here rather than silently absent.

## Frontend: the recommendation is part of the investigation response, not a second fetch

`InvestigationResponseSchema` (`packages/types`) is
`InvestigationResultSchema` extended with `recommendation:
RecommendationSchema.nullable()` — defined in `packages/types`, not
`packages/agent`'s `agent.ts`, because `packages/agent` has no concept of
a recommendation at all; this composite is purely an `apps/api` HTTP
response shape. `ResultView` only renders the `RecommendationCard` for a
`REFUND_PAYMENT` recommendation — a `NO_ACTION` one is redundant with the
root-cause card's own "no significant anomaly" state, so showing both
would be noise. The confirmation dialog (`ConfirmRefundDialog`) is a
second, distinct click naming the exact action ("Confirm Refund"), never
"OK"/"Continue" — enforced by never rendering a generically-labeled button
anywhere in this flow (see the frontend security tests).

**Known simplification:** the recommendation UI shows the internal
`targetPaymentId` (a cuid) rather than a `pay_xxxxxxxxx`-style Razorpay
id, since the Recommendation DTO doesn't denormalize the Razorpay payment
id for display. Adding that purely for cosmetic parity with the brief's
mockup wasn't judged worth a schema change; a merchant can still cross-
reference the payment via the Payments page.

## Evaluation: behavioral scenarios, not a scored metrics harness

Phase 4's evaluation harness computes rates (precision/recall/etc.) across
scenarios because detection accuracy is genuinely a measurable rate. Phase
5's required scenarios (A–H) are pass/fail behavioral guarantees — state
machine correctness, idempotency, isolation — not something meaningfully
expressed as an accuracy percentage. They're implemented directly as
`apps/api/src/__tests__/phase5Evaluation.test.ts`, run against
`apps/api/src/eval/fakeDatabasePhase5.ts` (a small, self-contained
in-memory fake covering `payment`/`recommendation`/`action`/`auditEvent` —
deliberately separate from Phase 4's `fakeDatabase.ts`, which extends
`@paysherlock/agent`'s aggregation-focused fake and has no concept of
these tables) and a mocked `RazorpayClient` — no live credentials, no live
Postgres.

## Test Mode requirement

`RAZORPAY_KEY_ID`/`RAZORPAY_KEY_SECRET` must be Test Mode credentials
(`rzp_test_...`) for any real exercise of this flow — the same variables
Phase 1's ingestion/webhooks already required. `RazorpayClient` has no
code-level "test vs. live" switch of its own (matching how Razorpay's own
API works: mode is a property of which key pair you use, not a request
parameter), so this is an operational/credential discipline documented
here and in the root README, not something the code enforces or could
enforce without Razorpay exposing a distinguishing API signal.

## Security boundaries carried forward and newly added

- Every recommendation/action endpoint derives `merchantId` via
  `resolveMerchant` server-side — never from the request body or a
  path/query parameter a client controls.
- `POST /recommendations/:id/approve|reject|retry` accept **no request
  body at all** — there is nothing for a client to override (amount,
  payment id, risk level, merchant id all come from the persisted row).
  Verified directly in `apps/api/src/__tests__/recommendations.test.ts`.
- A cross-merchant approval attempt returns `not_found` (the merchant-
  scoped `WHERE` clause simply never matches), not a `403` that would
  confirm the recommendation's existence to the wrong tenant.
- Audit events (`RECOMMENDATION_CREATED/APPROVED/REJECTED`,
  `ACTION_STARTED/SUCCEEDED/FAILED`) are append-only — `packages/database`
  exposes no update/delete function for `AuditEvent` at all, so there's no
  code path that could edit history even by mistake.
- `Action.errorCode`/`errorMessage` are always the sanitized strings
  `executeRefund` produces (`"PROVIDER_HTTP_400"`, `"Razorpay rejected the
refund request"`, …) — never a raw provider response body, stack trace,
  or the underlying `Error.message` from an unexpected exception.

## Known limitations (stated plainly, not hidden)

- No live Postgres or live Razorpay Test Mode in this environment (same as
  every prior phase) — the full flow is verified via the Phase 5
  evaluation harness's synthetic, deterministic data and a mocked
  `RazorpayClient`, plus the same mocked-`Database` unit-test convention
  every other package in this repo uses.
- Only `REFUND_PAYMENT` and `NO_ACTION` exist — no capture, payment links,
  settlements, bulk operations, or multi-approver workflows, per the
  brief's explicit scope boundary.
- Recommendation generation is only wired to payment-scoped, merchant-
  initiated investigations (see above) — not to Phase 4's automatic
  detection-triggered investigations.
- The refund executor computes the recommended amount as the payment's
  _full_ remaining refundable amount — there is no UI for a merchant (or a
  future model) to propose a smaller partial-refund amount; the
  eligibility validation supports it (`validateRefundEligibility` accepts
  any positive amount up to the refundable ceiling), but nothing in this
  phase generates a partial-amount candidate.
- `resolveStaleIssues`-style auto-expiry doesn't apply here; a
  `PENDING_APPROVAL` recommendation's only time-based transition is the
  fixed 24-hour `expiresAt` set at creation — not configurable per-merchant
  in this phase.
