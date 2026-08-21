# 0003 — Investigation Command Center

Status: Accepted (Phase 3)

This records the non-obvious decisions made building `apps/web`, and why.
See [`docs/architecture`](../architecture) for what was built.

## A thin `GET /overview` endpoint, not a duplicate investigation engine

The brief needs real aggregate numbers (revenue, success rate, "AI detected
issues") for the Overview and Issues pages, but Phase 1/2 only exposed
`GET /payments` and `POST /investigations` — neither returns merchant-wide
metrics or a hypothesis list on its own, and re-running a full LLM-backed
investigation just to paint a dashboard would be slow, non-deterministic,
and pointless (nobody asked a question).

`packages/agent/src/runtime/snapshot.ts::runDeterministicSnapshot` factors
the _tool-execution + hypothesis-verification_ half of
`runInvestigation` out into its own function — same tool registry, same
`DEFAULT_INVESTIGATION_STEPS`, same `verifyHypotheses` — and skips both
`provider.plan()` and `provider.narrate()` entirely. `apps/api`'s new
`getOverview` service calls it once per request and maps the resulting
hypotheses to `OverviewIssue`s by status (`SUPPORTED` → critical,
`INCONCLUSIVE` → warning, `REJECTED` → normal, filtered out of the list).

**Why:** this satisfies "Overview/Issues must show real AI-derived
signals" and "don't duplicate the investigation engine" at the same time —
it's the same deterministic pipeline Phase 2 already built and tested,
reused, not reimplemented. It is explicitly _not_ autonomous monitoring:
`runDeterministicSnapshot` runs synchronously inside the HTTP request, on
demand, with no scheduler, no background worker, and no persisted
detection timestamp. The Overview/Issues pages' copy says so directly
("run on the current payment data, not from a background monitor") so the
UI never implies Phase 4 exists yet.

## `InvestigationResult.hypotheses`: additive schema field, not a new endpoint

The brief's hypothesis section needs every candidate's status
(SUPPORTED/REJECTED/INCONCLUSIVE), but `InvestigationResultSchema` only
ever exposed `rejectedHypotheses: string[]` — bare statement strings for
the rejected ones, nothing for the supported or inconclusive ones by id.

Added `hypotheses: z.array(HypothesisSchema).default([])` to the schema
(kept `rejectedHypotheses` in place rather than removing it, to avoid a
breaking change to existing consumers/tests) and threaded the already-computed
`params.hypotheses` through `assembleInvestigationResult`. `.default([])`
means the existing `contracts.test.ts` fixture — built before this field
existed — still validates unmodified.

**Why:** the full hypothesis set already exists in memory at the end of
`verifyHypotheses` inside every investigation; the frontend just never had
a contract to receive it through. This was a one-line, backward-compatible
schema extension rather than a new endpoint or a frontend-side
reconstruction of statuses it has no way to know for certain.

## No fabricated multi-turn conversation memory

Phase 2 has no server-side investigation memory — each `POST
/investigations` call is independent. The brief explicitly allows treating
a "follow-up" as a new investigation request with context, rather than
building conversation state.

`ResultView`'s follow-up control (and every "Investigate this" affordance
elsewhere — issue cards, payment detail drawer) navigates to
`/investigate?q=<question>`, which pre-fills and does not auto-submit the
question form. This is a genuinely new, independent `POST /investigations`
call under the hood; nothing pretends the backend remembers the prior
question or accumulates context across turns.

**Why:** building an actual conversation-memory system would be
architecture the backend doesn't support and the brief didn't ask for —
"no complex conversation memory system" is explicit. Prefilling (not
auto-submitting) also means the merchant always sees and can edit the
exact question before it's sent, rather than the UI silently firing a
request on their behalf.

## Progress UX: an honest, labeled step sequence — not fake tool-call streaming

`packages/agent`'s `DEFAULT_INVESTIGATION_STEPS` executes server-side in
one request/response cycle; there is no SSE/websocket channel and the
brief says real per-tool streaming is not required (only "if easy" — it
isn't, without backend work out of scope for this phase).

`ProgressView` shows the same step _labels_ the backend actually executes
(humanized, e.g. "Comparing this period to baseline"), advancing on a
timer up to the last step and then holding there until the real response
arrives or errors. It's presented as an approximate reflection of a real,
bounded pipeline — not a live trace, and not a bare spinner either.

**Why:** a generic spinner tells the merchant nothing about what's
happening and reads as a black box; genuine per-step streaming would
require inventing a backend capability that doesn't exist and wasn't
asked for. This is the honest middle ground the brief calls for.

## Session-only history, explicitly not "your investigation history"

Phase 2 persists nothing about past investigations — every `POST
/investigations` response is returned once and forgotten server-side.
`apps/web/lib/history/sessionHistory.ts` stores completed investigations in
`sessionStorage` (not `localStorage`), and the History page's copy says
"Stored in your browser for this session only — not saved on the server"
and "Investigations you run will appear here until you close this tab."

**Why:** `sessionStorage` over `localStorage` is a deliberate honesty
signal, not just an API choice — the brief requires never implying
permanence the backend doesn't provide. Only successful investigations are
recorded (a failed attempt saves nothing), since a saved "history entry"
implies a completed result exists to revisit.

## `apps/web` owns its own `Payment` schema, and does not import `@paysherlock/agent`

Two deliberate non-sharing decisions:

- **Payments**: Phase 1 never defined a shared `Payment` DTO in
  `packages/types` for the API response shape `GET /payments` actually
  returns — `apps/web/lib/api/payments.ts` defines a local
  `PaymentSchema`/`PaymentsPageSchema` against the real, observed response
  shape rather than inventing a shared-package addition to backfill.
- **Currency formatting**: `formatCompactINR` in
  `apps/web/lib/formatters/currency.ts` reimplements the same "₹1.72L"-style
  formatting `packages/agent/src/output/formatter.ts::formatMinorUnitsAsINR`
  already does server-side, instead of importing `@paysherlock/agent` into
  the browser bundle.

**Why:** `packages/agent` pulls in the tool registry, hypothesis catalog,
and (transitively) `packages/database`/Prisma-adjacent types — none of
which belong in a client bundle, and importing it would blur the
server/client boundary `AGENTS.md` establishes. The two formatters are
~15 lines and intentionally kept in sync by eye rather than justifying a
new shared `packages/formatting` package for one function.

## Dark-only theme, no light/dark toggle

`app/globals.css` defines the full palette as `@theme` tokens once, sets
`color-scheme: dark` on `<html>`, and there is no toggle or
`prefers-color-scheme` branching.

**Why:** the brief's design language ("dark graphite foundation... financial
intelligence terminal") is a single deliberate identity, not a preference
setting — Linear and similar reference products commit to one theme rather
than maintaining two. Revisit if a future phase adds multi-tenant/white-label
theming requirements.

## Known limitations (carried forward honestly, not hidden)

- No live Postgres in this environment — the frontend has been verified
  against the real API contract (schema-validated responses, real CORS
  preflight, real error-handling middleware) with the database
  unreachable, which is itself a real exercise of every error state, but
  not against real merchant data end-to-end.
- `GET /overview`'s "AI Detected Issues" reuses Phase 2's fixed 5-hypothesis
  catalog — it will not surface an anomaly type outside that catalog. This
  is the same limitation Phase 2 already documents, not a new one.
- Settings is a non-functional placeholder in the sidebar, exactly as the
  brief specifies — clicking it does nothing yet.
- No autonomous monitoring, scheduled investigations, notifications,
  refunds, payment capture, payment links, merchant approval workflows, or
  production authentication were implemented — all explicitly out of scope
  for this phase.
