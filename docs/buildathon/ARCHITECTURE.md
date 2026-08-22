# PaySherlock — Architecture (Buildathon)

One page, for a judge. For full per-phase depth (schemas, module lists,
API tables), see [`docs/architecture/README.md`](../architecture/README.md).

## The full pipeline

```
                              ┌─────────────────────────────────────────┐
                              │            DETERMINISTIC                │
                              │   (no LLM anywhere in this box)          │
                              └─────────────────────────────────────────┘

Razorpay Test Mode                                                     Merchant
  (webhooks + REST)                                                    approval
       │                                                                   ▲
       ▼                                                                   │
┌─────────────┐     ┌──────────────┐     ┌────────────────────────┐       │
│  packages/  │────▶│  packages/   │────▶│    packages/detection   │       │
│  razorpay   │     │  database    │     │  5 threshold detectors  │       │
│ (adapter,   │     │ (normalized, │     │  → Issue (DETECTED)     │       │
│  signature  │     │  idempotent  │     └────────────┬───────────┘       │
│  verify)    │     │  upserts)    │                  │                   │
└─────────────┘     └──────────────┘                  ▼                   │
                                          ┌─────────────────────────────┐  │
                                          │      DETECTION → ISSUE       │  │
                                          └──────────────┬───────────────┘  │
                                                          │ new issue only   │
                              ┌───────────────────────────┴──────────────┐  │
                              │              AI-ASSISTED                  │  │
                              │  (LLM plans + narrates; never decides     │  │
                              │   facts, never touches money or DB)       │  │
                              └───────────────────────────┬──────────────┘  │
                                                          ▼                  │
                                          ┌─────────────────────────────┐   │
                                          │   packages/agent            │   │
                                          │   provider.plan()  (LLM)    │   │
                                          │      → packages/tools       │   │
                                          │      → packages/database    │   │
                                          │   hypotheses/verifier.ts    │   │
                                          │      (deterministic rules)  │   │
                                          │   provider.narrate() (LLM)  │   │
                                          └──────────────┬───────────────┘  │
                                                          ▼                  │
                              ┌───────────────────────────────────────────┐ │
                              │            DETERMINISTIC                  │ │
                              └───────────────────────────┬───────────────┘ │
                                                          ▼                  │
                                          ┌─────────────────────────────┐   │
                                          │   packages/actions           │   │
                                          │   generate → validate →      │   │
                                          │   risk policy → Recommendation│  │
                                          │        (PENDING_APPROVAL)     │  │
                                          └──────────────┬───────────────┘   │
                                                          │ merchant reviews  │
                                                          └───────────────────┘
                                                          │ explicit "Approve & Refund" click
                                                          ▼
                                          ┌─────────────────────────────┐
                                          │   packages/actions           │
                                          │   re-validate live state →   │
                                          │   Razorpay refund → verify   │
                                          │   → Action SUCCEEDED/FAILED  │
                                          │   → AuditEvent (append-only) │
                                          └─────────────────────────────┘
```

## What is deterministic vs. AI

| Stage                                                        | Deterministic            | AI-assisted       |
| ------------------------------------------------------------ | ------------------------ | ----------------- |
| Ingesting payments (webhooks + REST pull)                    | ✅                       |                   |
| Anomaly detection (5 detectors, thresholds, severity)        | ✅                       |                   |
| Deciding _whether_ to investigate                            | ✅                       |                   |
| Planning which tools to call                                 |                          | ✅ (plan step)    |
| Executing tools / reading the database                       | ✅                       |                   |
| Testing hypotheses against tool output                       | ✅ (rule-based verifier) |                   |
| Picking the root cause among supported hypotheses            | ✅ (ranking rule)        |                   |
| Writing the explanation/summary text                         |                          | ✅ (narrate step) |
| Generating a recommendation candidate                        | ✅                       |                   |
| Validating eligibility (amount, ownership, already-refunded) | ✅                       |                   |
| Risk level (LOW/MEDIUM/HIGH)                                 | ✅                       |                   |
| Approving a recommendation                                   | ✅ (merchant, human)     |                   |
| Calling Razorpay / moving money                              | ✅                       |                   |
| Idempotency, audit logging, state transitions                | ✅                       |                   |

**The LLM is used for exactly two structured calls per investigation** —
`plan()` (pick which tools to call, from a fixed catalog) and `narrate()`
(phrase already-decided facts into readable text) — and never for a third
purpose. It never touches Postgres, never calls Razorpay, never decides a
number, and never approves or executes anything. See
[`docs/buildathon/SAFETY.md`](SAFETY.md) for why this boundary is enforced
in code, not just in the prompt.

## Package map

```
apps/web                Merchant dashboard (Next.js)
apps/api                 HTTP API (Fastify) — routes, services, webhook processing
packages/razorpay        The only code that speaks Razorpay's HTTP API
packages/database        Prisma schema + typed, merchant-scoped queries/upserts
packages/detection        5 deterministic anomaly detectors + Issue lifecycle
packages/agent            LLM provider abstraction + bounded investigation loop
packages/tools            Typed, validated tools the agent calls (no raw DB access)
packages/actions          Recommendation generation, risk policy, refund executor
packages/types            Shared schemas/DTOs/error taxonomy
workers/investigator      Detection scheduler + Buildathon demo-mode scripts
```

Each arrow in the diagram above is a real package boundary — e.g.
`packages/detection` never imports `@paysherlock/agent`, and
`@paysherlock/agent` never imports `@paysherlock/razorpay`. See
[`AGENTS.md`](../../AGENTS.md) for the standing rules this enforces.
