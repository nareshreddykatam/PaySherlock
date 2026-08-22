# PaySherlock — Buildathon Overview

Built for the Razorpay Buildathon (Open Track). This folder is written for
a technical judge who needs to understand and evaluate PaySherlock
quickly. See also: [`ARCHITECTURE.md`](ARCHITECTURE.md) (the pipeline),
[`DEMO.md`](DEMO.md) (how to run it), [`EVALUATION.md`](EVALUATION.md)
(test/scenario results), [`SAFETY.md`](SAFETY.md) (financial-safety
guarantees and the security checklist).

## 1. What is it?

An AI payment-intelligence agent for Razorpay merchants. It watches a
merchant's payment data, deterministically detects anomalies (a UPI
failure spike, a refund spike, a volume decline, …), automatically
investigates _why_ using an LLM-assisted-but-deterministically-verified
process, explains the root cause and estimated business impact in plain
language, and — only with explicit merchant approval — can execute a
guarded refund.

## 2. What problem does it solve?

Merchants can see _that_ a metric moved but figuring out _why_ normally
means manually digging through dashboards, filtering transactions, and
guessing at correlations. PaySherlock does that investigation
automatically and surfaces the answer with evidence, not a bare
assertion.

## 3. What's different about this vs. a generic "AI wrapper"?

Three things, all enforced in code, not just in a prompt:

- **The LLM never decides a fact.** It plans which read-only tools to
  call and phrases already-decided results into text; a deterministic
  rule-verifier decides which hypothesis is actually supported by the
  tool output. See [`ARCHITECTURE.md`](ARCHITECTURE.md#what-is-deterministic-vs-ai).
- **The LLM never touches money.** There is exactly one code path from a
  recommendation to a Razorpay refund call
  (`POST /recommendations/:id/approve`), and it requires an explicit
  human click — no agent, worker, or detector can reach it. See
  [`SAFETY.md`](SAFETY.md).
- **Every financial action is idempotent, re-validated against live
  state, and audited.** A retry, a double-click, or a race can never
  produce two refunds — proven by dedicated evaluation scenarios (Phase
  5/6, scenarios G/H/I/K), not just asserted.

## 4. How does the architecture work?

`Detection → Investigation → Explanation → Recommendation → Human
Approval → Guarded Action → Verification → Audit`. Full diagram and
package map in [`ARCHITECTURE.md`](ARCHITECTURE.md).

## 5. What is the AI actually doing?

Exactly two structured LLM calls per investigation:

1. **`plan()`** — given a merchant's question (or an auto-generated one
   from a detected anomaly) and a fixed catalog of typed tools, propose
   an investigation plan (which tools to call, and candidate hypotheses
   to test).
2. **`narrate()`** — given the deterministic hypothesis-verification
   result and the evidence gathered, write the summary/explanation text a
   merchant reads.

Both calls are provider-independent (`packages/agent/src/provider`);
`AI_PROVIDER=anthropic` uses a real model, `AI_PROVIDER=deterministic`
(the default, and what every automated test uses) needs no AI credentials
at all and always proposes the canonical tool sequence.

## 6. What is deterministic (not AI)?

Anomaly detection and its thresholds/severity, all financial
calculations (amounts, refund eligibility, risk level), which hypothesis
is "supported" (a rule-based verifier reading real tool output, never an
LLM confidence score), merchant authorization/scoping, approval,
idempotency, audit logging, and every state transition. See the table in
[`ARCHITECTURE.md`](ARCHITECTURE.md#what-is-deterministic-vs-ai) — this
distinction matters for judging what's actually "AI" here versus
conventional software.

## 7. What financial actions can it perform?

**Exactly one:** a refund of a specific payment, and only:

- for a recommendation the deterministic validation pipeline approved
  (real payment, correct merchant, within the refundable balance, not
  already fully refunded),
- after an explicit merchant click ("Approve & Refund" → "Confirm
  Refund"),
- against Razorpay **Test Mode** only.

No bulk refunds, payment capture, payment links, settlement automation,
or any autonomous/unapproved action exist or are planned for this
submission. See [`SAFETY.md`](SAFETY.md) for the full "what PaySherlock
does not do" list.

## 8. How is financial safety handled?

Ten explicit guarantees (integer minor units, live-state re-validation,
mandatory approval, mandatory idempotency, no re-execution of a
successful action, retries reuse the same logical action, immutable
audit trail, provider response verified before claiming success, and
more) — each backed by a named test. Full table in
[`SAFETY.md`](SAFETY.md).

## 9. How do I run the demo?

```bash
pnpm install
cp .env.example .env   # DATABASE_URL only needed for the demo script; not for the test suite
pnpm --filter @paysherlock/database run db:migrate:dev
pnpm --filter @paysherlock/investigator-worker run demo:seed
pnpm --filter @paysherlock/investigator-worker run demo:run
```

Full script, including the separate guarded-refund scenario, in
[`DEMO.md`](DEMO.md).

## 10. How do I run the tests?

```bash
pnpm install
pnpm build && pnpm typecheck && pnpm lint && pnpm format:check
pnpm test
```

364 tests across 9 packages, plus the Phase 4/5/6 evaluation harnesses
(`pnpm --filter @paysherlock/api run eval:phase4` and `eval:phase6`) —
none require a live database, live Razorpay credentials, or an AI API
key. Full breakdown in [`EVALUATION.md`](EVALUATION.md).

## "No fake AI" — what this means in practice

Everything a merchant sees is produced by the real pipeline against real
(in production) or synthetic-but-real-code-path (in the demo) data:

- No hard-coded AI results anywhere in `apps/web` — every investigation
  result, evidence item, hypothesis, and recommendation rendered by the
  frontend comes from a real API response, schema-validated before the
  UI ever sees it.
- No fake streaming or fake progress — `ProgressView`'s step labels
  mirror the backend's actual `DEFAULT_INVESTIGATION_STEPS`; there is no
  simulated typing/thinking animation standing in for a real call.
- No fake issue generation — the demo mode (`workers/investigator/src/demo/`)
  seeds _payment data_, then runs the exact same `runDetectionForMerchant`
  the scheduled worker and Phase 4/6 evaluation harnesses use. It does
  not construct an `Issue` row directly or skip detection.
  Demo **data** is synthetic and clearly marked (`pay_demo_...` ids,
  `raw: {demo: true}`); demo **behavior** is not.
- No fake notifications or fake action success — `useIssueNotifications`
  only ever notifies on a real polled `GET /issues` diff; a refund
  `Action` only ever reports `SUCCEEDED` after Razorpay's own refund
  status confirms it (see [`SAFETY.md`](SAFETY.md), guarantee 9).

## Current limitations (stated plainly)

- Single-merchant demo/local setup — no production authentication or
  multi-tenant login exists; merchant scoping is proven at the data-model
  and query level (every route/query is merchant-scoped and tested for
  cross-merchant isolation), not behind a login wall.
- One financial action type (refund). No bulk operations, capture, or
  settlement automation.
- Notifications are in-app only (polling), no email/SMS/Slack.
- The demo's guarded-refund step, run against seeded synthetic payment
  ids, correctly surfaces a `FAILED` action rather than a fabricated
  success — see [`DEMO.md`](DEMO.md) for how to see the full `SUCCEEDED`
  path against a real Test Mode payment instead.
- Root-cause accuracy on the Phase 6 harness's own scenario set is 0.60,
  not 1.00 — reported honestly, not smoothed over. See
  [`EVALUATION.md`](EVALUATION.md).
