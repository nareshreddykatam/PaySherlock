# 0004 — Proactive Payment Intelligence

Status: Accepted (Phase 4)

This records the non-obvious decisions made building the deterministic
detection engine (`packages/detection`), the persisted `Issue` model, the
detection worker (`workers/investigator`), and how they connect to the
unmodified Phase 2 investigation engine — and why. See
[`docs/architecture`](../architecture) for what was built.

## The hard architectural rule: detection decides "is this anomalous", the agent decides "why"

Every decision in this phase traces back to one line from the brief: code
determines whether something is anomalous; the LLM only ever explains why
it's probably happening, once code has already decided an anomaly exists.
`packages/detection` has zero AI/LLM dependency — no `@paysherlock/agent`
import anywhere in it — and every detector's ANOMALY/INSUFFICIENT_DATA
decision is a deterministic threshold comparison on numbers computed via
Prisma `aggregate`/`groupBy`. The moment a detector decides something is
worth investigating, code hands off to the _existing, unmodified_ Phase 2
`runInvestigation` — no second agent, no second planner, no second
hypothesis engine was written for this phase.

## Detection package structure and the detector interface

`packages/detection/src/{baseline,severity,fingerprint,engine,detectors}` —
a `Detector` is `{ type: AnomalyType; detect(ctx): Promise<DetectionResult[]> }`,
where `ctx = { merchantId, db, now, config? }`. Each of the five detectors
is independently testable (own unit test file, own synthetic fixtures,
no dependency on the others) and safe to call repeatedly — a detector never
mutates anything; only `engine/detectionRun.ts` (see below) touches the
database's `Issue` table. `engine/registry.ts::runDetectors` runs all five
via `Promise.all` and isolates one detector's failure from the rest — a
thrown error becomes a `{type, message}` entry in `errors`, never a crashed
detection run.

## Baseline methodology: comparable time-of-day windows, not "today vs. yesterday"

`baseline/window.ts::comparableBaselineWindows` builds N windows (default 7)
of the _same duration_ as the current window, each shifted back by whole
days — e.g. today's 10:00–11:00 vs. 10:00–11:00 on each of the preceding 7
days. `baseline/compare.ts::compareToBaseline` reports the mean, min, and
max across those N readings, plus absolute/relative change.

**Why:** the brief explicitly asks for comparable windows over a naive
"today vs. yesterday" diff, and warned against overclaiming statistical
sophistication. This is a same-time-of-day heuristic, not a forecasting
model — every window compared has the _identical_ duration, so (unlike
Phase 2's tools) no duration-scaling arithmetic is needed at all, which is
also what makes it simple enough to trust for a Buildathon MVP.

## Minimum sample size: different meaning for a rate vs. a count metric

Every detector defines its own `minSampleSize`/`minBaselineSampleSize`
(`engine/defaults.ts`, all configurable via `DetectorRuntimeConfig`). A
current-window sample below the threshold produces `INSUFFICIENT_DATA`,
never a fabricated anomaly (the brief's "1 failed payment out of 2 payments
must not become CRITICAL").

**A deliberate asymmetry:** for _rate_ metrics (failure rate, refund rate,
method failure rate) a tiny current sample makes the rate itself
unreliable, so those detectors gate on it directly. For _count_ metrics
(transaction volume, high-value transaction count) a small current count
**is** the signal, not noise — "attempts crashed to near zero" is real
information — so those two detectors only gate on the _baseline_ having
enough history to be a trustworthy comparison point, never on the current
count. This is documented in each detector file and is why the Phase 4
evaluation harness's small-sample scenario legitimately produces both an
`INSUFFICIENT_DATA` result (from the rate-based detectors) and a real
`TRANSACTION_VOLUME_DECLINE`/`HIGH_VALUE_TRANSACTION_DECLINE` anomaly (from
the count-based ones) from the very same tiny window — see
`apps/api/src/eval/runPhase4Evaluation.ts`'s scenario F assertions.

## Severity: magnitude + sample confidence + optional impact, never persistence, never confidence

`severity/severity.ts::computeSeverity` is a pure function of one detection
result — magnitude (percentage-points for rate metrics, relative % for
count metrics), how far the sample size clears the minimum (a borderline
sample gets downgraded one level), and an optional large-impact override.
It has no memory of past runs and is entirely separate from an
investigation's `confidence` (low/medium/high) — a CRITICAL anomaly with
MEDIUM investigation confidence is expected and valid, per the brief.

**Persistence-based escalation lives one layer up, in `engine/detectionRun.ts`,
not in the severity function** — a brand-new issue's severity is capped at
WARNING (`capFirstOccurrenceSeverity`) no matter how extreme the raw
detector reading; only a _second_ detection run that reconfirms the same
issue (via its fingerprint) is allowed to reach CRITICAL. This is the
concrete mechanism behind the brief's scenario G ("one-window transient
spike → no critical issue") vs. scenario H ("persistent anomaly →
issue created, investigation triggered once, can reach CRITICAL").

## Fingerprint: type + dimension + UTC day, deliberately coarser than the brief's own example

`fingerprint/fingerprint.ts::computeFingerprint` = `type:dimension:dayBucket`
(merchant is intentionally _not_ part of the string — every lookup already
scopes by `merchantId` as a separate, trusted parameter, matching how every
other query in this codebase works). The brief's own illustrative example
uses an hour-level bucket; this implementation uses a day-level bucket
instead; the reasoning:

An hour-level bucket would fragment one ongoing incident into a new issue
every time the rolling detection window crosses an hour boundary — exactly
the "investigation storm" the brief says to prevent. A day-level bucket
lets one real anomaly keep updating the _same_ issue across many detection
runs and window boundaries within a day, while a resolved issue whose
fingerprint recurs on a _later_ day still opens a fresh one (see the
"different time bucket → correct lifecycle" test in
`packages/detection/src/__tests__/fingerprint.test.ts`). Known trade-off: an
anomaly that genuinely persists across a UTC day boundary opens a new issue
for the new day rather than one continuously-open issue — acceptable for
this MVP's demo timeframe (detection runs every 15 minutes; the realistic
window under test is hours, not multiple days), and documented here as a
limitation rather than hidden.

**Uniqueness is enforced in application code, not a DB constraint** —
`findActiveIssueByFingerprint` only ever matches non-terminal statuses
(`DETECTED`/`INVESTIGATING`/`IDENTIFIED`/`MONITORING`/`INVESTIGATION_FAILED`).
A `RESOLVED`/`DISMISSED` row never blocks a brand-new issue from being
created later under the same fingerprint — that's the whole point of a
lifecycle status, and a hard unique index would have prevented it.

## Automatic investigation: the exact detected window, not Phase 2's default

`engine/detectionRun.ts::triggerInvestigation` calls the same
`runInvestigation`-backed function apps/api's `POST /investigations` uses,
passing `timeRange: { startTime: result.windowStart, endTime: result.windowEnd }`
explicitly. Without this, `resolveDefaultToolArgs` would fall back to Phase
2's default "yesterday" window, which may not even overlap the anomaly the
detector just found — a real bug caught while building the Phase 4
evaluation harness (see the harness's fixture comments for the full story).
The investigation's _baseline_, however, still comes entirely from Phase
2's own unmodified "preceding 7 days, duration-scaled" logic — this phase
does not, and should not, change how Phase 2 picks its baseline.

## Storm prevention and investigation-failure handling

`shouldTriggerInvestigation` only fires for a brand-new issue, or an
existing one whose status is `DETECTED` or `INVESTIGATION_FAILED` (never
`INVESTIGATING`/`IDENTIFIED`/`MONITORING`) — a second detection run for an
already-being-worked-on issue only updates its metrics/occurrence count,
never re-triggers. `INVESTIGATION_FAILED` is a deliberate exception: a
transient provider error shouldn't strand an issue forever, so a later
detection run gets one retry. A failed investigation is _never_ deleted or
silently dropped — `investigationError` stores a safe, sanitized message
(`error.message`, never a stack trace) alongside the kept issue.

## Resolution: a practical staleness policy, not trend analysis

`resolveStaleIssues` auto-resolves any active issue whose `updatedAt`
predates `now - DEFAULT_STALE_AFTER_MS` (2 hours, independent of the
detection cadence). An issue is only "confirmed" by being re-detected under
the same fingerprint, so once a detection run stops finding the anomaly,
the issue simply stops being touched and ages out. This is explicitly a
practical MVP policy — not a forecast of whether the anomaly is truly gone
— documented as such rather than dressed up as more sophisticated than it
is.

## Issue persistence: one model, an application-level uniqueness rule, a cached investigation result

`Issue` (see `packages/database/prisma/schema.prisma`) stores the
detector's metrics directly (`metric`/`currentValue`/`baselineValue`/
`absoluteChange`/`relativeChange`/`sampleSize`/`dimension`) plus, once
investigated, `rootCause`/`confidence`/`estimatedImpactMinorUnits` and a
full `investigationResult: Json?` — the entire `InvestigationResult` the
triggering investigation produced, cached at completion. This avoids
building a second, separate investigation-persistence layer just to power
the issue-detail view's evidence/hypothesis rendering: the `Issue` row
_is_ the source of truth for both "what anomaly was detected" and "what the
investigation found", matching how `Payment.raw` already preserves a full
source payload alongside typed columns elsewhere in this schema.

## Why the detect→issue→investigate orchestration lives in `packages/detection`, not `apps/api`

The first draft put `runDetectionForMerchant` in `apps/api/src/services/`,
since that's where `apps/api`'s other read/service logic lives. It moved to
`packages/detection/src/engine/detectionRun.ts` once the worker
(`workers/investigator`) needed the exact same function: apps don't import
each other in this monorepo (only packages are shared library surfaces), so
keeping it in `apps/api` would have meant either duplicating the
orchestration in the worker or having the worker reach into `apps/api`'s
internals, both worse than moving it to the shared package it logically
belongs to. `packages/detection` was already the right home dependency-wise
— it already depends on `@paysherlock/database` for the Issue upsert
functions the orchestration needs, and only needs `InvestigationRequest`/
`InvestigationResult` _types_ from `@paysherlock/types` to describe the
`runInvestigation` callback it accepts — it still never depends on
`@paysherlock/agent` itself. `apps/api`'s own Phase 4 evaluation harness
(`apps/api/src/eval/`) imports `runDetectionForMerchant` from
`@paysherlock/detection` the same way the worker does.

## Detection worker: a plain `setInterval` loop, not BullMQ/Redis

`workers/investigator` resolves the single MVP merchant
(`resolveMerchant(db, {})`, the same single-tenant pattern `apps/api`
already uses), builds an investigation runner exactly like `apps/api`'s
entrypoint does, and calls `runDetectionForMerchant` either once
(`pnpm run detect` — the manual/demo path, brief section 27) or on a
`setInterval(..., DETECTION_INTERVAL_MS)` loop (`pnpm run start`, default
15 minutes, brief section 26). No BullMQ/Redis/cloud scheduler — the
placeholder worker package never had a queue wired up, and a Buildathon MVP
doesn't need distributed job scheduling for a single-merchant, single-process
periodic task. Every run logs a safe, structured record (`detectionRunId`,
`merchantId`, counts, timing, `status`) — never payment data, never
secrets.

## Phase 4 evaluation harness: a second synthetic fixture, deliberately not shared with Phase 2's

`apps/api/src/eval/` runs the full A–H required scenarios end-to-end
(detection → issue → the real Phase 2 engine → root cause), reusing
`@paysherlock/agent`'s exported `createFakeDatabase`/`makePayments`/
`makeRefunds` (newly exported from `@paysherlock/agent`'s public API for
this purpose) extended with an in-memory `issue` table
(`apps/api/src/eval/fakeDatabase.ts`) implementing the exact Prisma call
shapes `packages/database`'s issue functions use. This lives in `apps/api`,
not `packages/detection`, specifically because it needs the real
`@paysherlock/agent` investigation runner — a dependency `packages/detection`
must never take.

**A real bug this harness caught:** an early fixture draft generated dense
synthetic baseline data (spread across a full day at a large per-hour
count) that silently exceeded `packages/database`'s `getPaymentAmounts`
2000-row cap — a real, correct existing safety guard (never hand the LLM an
unbounded row dump), not a bug in Phase 2. The fix was a smaller,
recalibrated fixture density, not touching the cap. This is exactly the
kind of integration bug a full end-to-end harness catches that isolated
unit tests can't — the same lesson Phase 2's own ADR draws from its
duration-scaling bug.

## Security boundaries carried forward unchanged

The LLM still never touches Postgres, Razorpay credentials, or a financial
action directly — the detection worker constructs its own trusted
`merchantId` via `resolveMerchant`, never from anything a detector or the
model proposes, and every `Issue` query in `apps/api`'s routes is
merchant-scoped server-side (`GET /issues/:id` does `findFirst({id,
merchantId})`, never a bare `findUnique({id})`, so a guessed/leaked id from
another merchant can never be returned). No new code path in this phase
executes a financial action, sends a real notification outside the app, or
grants the model any new capability — see AGENTS.md's Forbidden Practices,
unchanged.

## Known limitations (stated plainly, not hidden)

- No live Postgres in this environment (same as every prior phase) — the
  full pipeline is verified via the Phase 4 evaluation harness's synthetic,
  deterministic data plus the same mocked-`Database` unit-test convention
  every other package in this repo uses.
- Fingerprint dedup resets at each UTC day boundary (see above) — a
  multi-day-persistent anomaly opens a fresh issue each day rather than one
  continuously-open issue.
- `resolveStaleIssues`'s 2-hour staleness window is a fixed practical
  default, not adaptive to detection cadence or merchant traffic patterns.
- The worker is single-merchant (matches this MVP's single-tenant scope
  throughout); a multi-merchant deployment would need a "list all
  merchants" query this phase didn't add, since none exists yet.
- In-app notifications are session-scoped (sessionStorage-deduped, same
  honesty convention as the History page) — closing the tab forgets what's
  already been shown; there is no server-side "notifications sent" ledger.
- Detectors do not independently estimate a rupee business impact (that
  stays the triggered investigation's job, via `calculate_revenue_impact`)
  — `computeSeverity`'s optional impact-based escalation parameter exists
  and is tested, but no detector currently supplies it, an intentional
  scope boundary matching "detection decides IS anomalous, investigation
  decides WHY and impact."
