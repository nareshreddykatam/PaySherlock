# workers/investigator — Detection Worker

**Status:** Phase 4 — implemented.

Runs `@paysherlock/detection`'s deterministic anomaly detection for the
merchant, persists findings as `Issue` records, and triggers the existing
Phase 2 investigation engine for newly-actionable ones — the same
detect → issue → investigate pipeline apps/api's evaluation harness
exercises, just on a schedule instead of on demand. See
[`docs/architecture`](../../docs/architecture) for the full data flow and
[`docs/decisions/0004`](../../docs/decisions/0004-proactive-payment-intelligence.md)
for why it's a plain interval loop rather than a queue.

## Commands

```bash
pnpm --filter @paysherlock/investigator-worker run detect   # run once, exit
pnpm --filter @paysherlock/investigator-worker run start    # run now, then every DETECTION_INTERVAL_MS
pnpm --filter @paysherlock/investigator-worker run dev       # `detect`, restarting on file change
```

`detect` is the fastest way to see an issue appear locally — it never waits
for the schedule.

## Configuration

Reads the same `DATABASE_URL`/`AI_PROVIDER`/`AI_MODEL`/`AI_API_KEY`/
`MAX_AGENT_STEPS` variables as `apps/api` (see the root
[`.env.example`](../../.env.example)), plus `DETECTION_INTERVAL_MS`
(default 15 minutes — only used by `run start`).

## What this worker deliberately does not do

No BullMQ/Redis/cloud scheduler — a plain `setInterval` loop is enough for
a single-merchant, single-process periodic task at this MVP's scale. No
second AI agent or planner — it calls the exact same investigation runner
`apps/api` does. No financial actions, no autonomous approvals — detection
only ever creates/updates an `Issue` and (for a genuinely new, actionable
one) triggers an investigation; nothing here executes a refund, capture,
payout, or any other money-moving operation.
