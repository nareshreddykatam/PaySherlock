# PaySherlock — Demo Script

This runs the real detection/investigation/recommendation pipeline
against synthetic seed data for one dedicated example merchant —
"PaySherlock Demo Merchant" — never against any other merchant's data,
and never inserted automatically. Nothing here is scripted UI behavior:
every number and status you see comes from the same code path a real
merchant's dashboard uses.

## Setup (once)

```bash
pnpm install
cp .env.example .env   # fill in DATABASE_URL (a local/throwaway Postgres) — Razorpay/AI keys are not required for the primary demo
pnpm --filter @paysherlock/database run db:migrate:dev
pnpm --filter @paysherlock/investigator-worker run demo:seed
```

`demo:seed` resolves (or creates) the demo merchant and writes 7 days of
healthy baseline payments plus a 1-hour UPI-degraded window — see
[`workers/investigator/src/demo/data.ts`](../../workers/investigator/src/demo/data.ts).
Run `demo:reset` at any point to delete and re-seed only this merchant's
data:

```bash
pnpm --filter @paysherlock/investigator-worker run demo:reset
```

## Primary demo (~5 minutes): UPI degradation

**1. Show the healthy state.** Start the API and web app:

```bash
pnpm --filter @paysherlock/api run dev
pnpm --filter @paysherlock/web dev
```

Open `http://localhost:3000` — the Overview page shows the demo
merchant's real metrics computed from the seeded baseline. Nothing is
flagged yet because the degraded window hasn't been detected.

**2. Trigger detection now** — no need to wait for the 15-minute worker
interval:

```bash
pnpm --filter @paysherlock/investigator-worker run demo:run
```

This calls `runDetectionForMerchant` directly — the exact function the
scheduled worker calls — and prints a JSON summary plus each created/
updated issue, including the automatically-triggered investigation's root
cause and estimated business impact.

**3. Show it in the UI.** Refresh the Issues page — the new
`PAYMENT_METHOD_DEGRADATION` issue appears with severity, the
investigation's root cause ("UPI payment failure rate increased
significantly"), supporting evidence, and an estimated revenue impact.
Open the issue detail page to walk through the evidence and hypothesis
list exactly as the investigation engine produced them.

**4. Narrate what just happened**, pointing at
[`docs/buildathon/ARCHITECTURE.md`](ARCHITECTURE.md): a deterministic
detector found the anomaly, a bounded two-call LLM investigation planned
which tools to run and phrased the result, and a deterministic
rule-verifier — not the LLM — decided which hypothesis was actually
supported.

**Stop here for the detection half of the demo — no refund happens yet.**

## Secondary demo (~2 minutes, separate from the above): guarded refund

The brief is explicit that the detection/investigation portion and the
refund portion should be demoed as separate, deliberately-controlled
scenarios — never blurred together as if a refund followed automatically
from the anomaly above.

1. From the Issues page, open the affected issue and use "Investigate this
   payment" against one of the seeded degraded-window UPI payments (the
   `demo:seed`/`demo:run` output prints its Razorpay id as
   `targetPaymentRazorpayId`). This produces a real, payment-scoped
   investigation and — because a root cause was found for a specific,
   still-refundable payment — a `REFUND_PAYMENT` recommendation.
2. Open the Recommendations page. The recommendation shows the exact
   amount, explanation, and risk level. Click "Approve & Refund", then
   confirm in the dialog that explicitly says "Confirm Refund" (never
   "OK"/"Continue").
3. **In this sandbox, the seeded payments are synthetic (`pay_demo_...`
   ids) and don't correspond to real Razorpay Test Mode resources** — so
   approving here will surface a safe `FAILED` action (Razorpay returning
   a real "payment not found" error), not a fabricated success. This is
   the honest behavior: PaySherlock never claims success it can't verify.
   To see the full `SUCCEEDED` path against a real Test Mode payment, run
   `pnpm --filter @paysherlock/api run ingest` first to pull real Test
   Mode payments into the database and generate a recommendation against
   one of those instead — or watch it already proven end-to-end,
   offline, in the Phase 5/6 evaluation harnesses (`pnpm test`,
   scenario G: "a valid guarded refund executes exactly once").

## Why the recommendation demo reuses the UPI-degradation anomaly

There is no "duplicate payment" detector in this codebase (Phase 2's
hypothesis catalog is fixed at 5 hypotheses: UPI failure increase,
transaction volume decline, refund spike, payment method degradation,
high-value decline). Rather than fabricate a detector that doesn't exist,
the recommendation half of the demo investigates one specific payment
from the same real anomaly the detection half already found — an honest
choice, not a shortcut. See "No Fake AI" in
[`docs/buildathon/README.md`](README.md).

## Other demo merchant scenarios

`workers/investigator/src/demo/data.ts` currently seeds one deterministic
scenario (UPI degradation). The Phase 6 evaluation harness
(`pnpm --filter @paysherlock/api run eval:phase6`) exercises the other
five illustrative scenarios named in the Buildathon brief (healthy,
payment failure spike, refund spike, volume decline, high-value decline)
as fully automated, offline pass/fail scenarios — see
[`docs/buildathon/EVALUATION.md`](EVALUATION.md) — rather than as
additional interactive `demo:seed` variants, to avoid multiplying
near-duplicate demo infrastructure beyond what the live walkthrough above
needs.
