# PaySherlock — Evaluation

All results below are **synthetic**: generated test data, a mocked
Razorpay client, and (for the deterministic-provider paths) no live LLM
call. Nothing here is a real-world production accuracy claim — see each
harness's own "Limitations" section for exactly what it does and doesn't
measure.

## Test suite

`pnpm test` runs **364 tests across 9 packages** (Turborepo, no AI
credentials, live database, or live Razorpay credentials required):

| Package                       | Tests | Covers                                                                                  |
| ----------------------------- | ----- | --------------------------------------------------------------------------------------- |
| `packages/razorpay`           | 27    | adapter, webhook verification, normalization, request timeouts                          |
| `packages/database`           | 62    | idempotent upserts, pagination, state-machine guards (Issue/Recommendation/Action)      |
| `packages/agent`              | 39    | provider abstraction, planning/execution loop, hypothesis verification                  |
| `packages/tools`              | 27    | every tool's input/output validation and merchant scoping                               |
| `packages/detection`          | 45    | all 5 detectors, baselines, severity, fingerprinting, dedup                             |
| `packages/actions`            | 34    | risk policy, refund eligibility, recommendation validation, refund executor             |
| `workers/investigator-worker` | 10    | config loading, scheduler overlap/shutdown behavior                                     |
| `apps/api`                    | 83    | routes, webhook processing, request correlation, Phase 4 + Phase 6 evaluation harnesses |
| `apps/web`                    | 37    | notification lifecycle, recommendation confirmation UX                                  |

`pnpm build`, `pnpm typecheck`, `pnpm lint`, and `pnpm format:check` all
pass with zero errors and zero warnings across all 11 packages.

## Phase 4 — Proactive detection (8 scenarios, A–H)

`pnpm --filter @paysherlock/api run eval:phase4` — run end-to-end against
the real, unmodified investigation engine and a synthetic in-memory
database (`apps/api/src/eval/fakeDatabase.ts`). All 8 pass: detection +
correct root cause for UPI failure/refund spike/volume decline/high-value
decline, no false anomaly on normal business, `INSUFFICIENT_DATA` (never a
fabricated anomaly) on a tiny sample, no single-run `CRITICAL` issue, and
no duplicate issue for a persistent anomaly.

## Phase 5 — Guarded actions (8 scenarios, A–H)

`apps/api/src/__tests__/phase5Evaluation.test.ts` (part of `pnpm test`) —
valid refund, already-refunded rejection, over-limit-amount rejection,
double-approval protection, provider-failure handling, expired-
recommendation rejection, merchant isolation, and retry — against
`apps/api/src/eval/fakeDatabasePhase5.ts` and a mocked `RazorpayClient`.
All 8 pass.

## Phase 6 — End-to-end lifecycle (12 scenarios, A–L)

`pnpm --filter @paysherlock/api run eval:phase6` — the full
`Detection → Investigation → Recommendation → Approval → Action →
Verification → Audit` lifecycle, deliberately reusing Phase 4's and Phase
5's fixtures rather than a fourth synthetic-data system. Generates
[`docs/evaluation/phase6-report.json`](../evaluation/phase6-report.json)
(machine-readable) and
[`phase6-report.md`](../evaluation/phase6-report.md) (human-readable).

All 12 scenarios pass:

| ID  | Scenario                                                                                       | Category  |
| --- | ---------------------------------------------------------------------------------------------- | --------- |
| A   | Healthy merchant → no false anomaly                                                            | detection |
| B   | UPI degradation → detected, investigated, evidence + impact                                    | detection |
| C   | Merchant-wide payment failure spike → detected, investigated                                   | detection |
| D   | Refund spike                                                                                   | detection |
| E   | Transaction volume decline                                                                     | detection |
| F   | High-value transaction decline                                                                 | detection |
| G   | Valid guarded refund → exactly one execution                                                   | action    |
| H   | Double approval → exactly one execution                                                        | action    |
| I   | Stale refund state → execution blocked before any provider call                                | action    |
| J   | Provider failure → safe FAILED + audit, never a false success                                  | action    |
| K   | Retry → same idempotency key, no duplicate action                                              | action    |
| L   | Cross-merchant isolation → issue/recommendation/action of one merchant inaccessible to another | security  |

### Headline metrics (from the current `phase6-report.md`)

| Area          | Metric                                 | Value                                                           |
| ------------- | -------------------------------------- | --------------------------------------------------------------- |
| Detection     | Recall                                 | 1.00                                                            |
| Detection     | False-positive rate                    | 0.00                                                            |
| Detection     | Duplicate issue rate                   | unavailable — measured instead by the Phase 4 multi-run harness |
| Investigation | Trigger success rate                   | 1.00                                                            |
| Investigation | Root-cause accuracy                    | 0.60                                                            |
| Investigation | Evidence accuracy                      | unavailable — no independent ground truth in this harness       |
| Actions       | Approval success rate                  | 1.00                                                            |
| Actions       | Duplicate execution rate               | 0.00                                                            |
| Actions       | Stale-state rejection rate             | 1.00                                                            |
| Actions       | Action success rate                    | 1.00                                                            |
| Actions       | False-success rate                     | 0.00                                                            |
| Reliability   | Unhandled exceptions                   | 0                                                               |
| Reliability   | Failed requests                        | unavailable — no real HTTP layer in this harness                |
| Security      | Cross-merchant access failures blocked | 3                                                               |
| Security      | Approval bypass attempts blocked       | 1                                                               |

See the generated report for the exact git commit and timestamp this ran
against, and its full "Limitations" section for what each `unavailable`
means and why.

### Why some metrics say "unavailable" instead of a number

The Phase 6 brief was explicit: never fabricate a metric. Root-cause
accuracy of 0.60 (not 1.00) reflects this harness's own small,
deliberately-varied scenario set — it is not tuned to look better than it
is. `evidenceAccuracy` and `failedRequests` are reported as `unavailable`
because this harness has no independent ground truth for the former and
no real HTTP transport for the latter to measure against; a fabricated
number would be worse than an honest gap.
