# 0002 — AI Investigation Engine

Status: Accepted (Phase 2)

This records the non-obvious decisions made building the agent
(`packages/agent`) and tool layer (`packages/tools`), and why. See
[`docs/architecture`](../architecture) for what was built.

## Plan-then-execute, not a turn-by-turn ReAct loop

The Phase 2 brief describes a classic agentic loop: ask the model for the
next step, execute if it's a tool call, repeat. We built something related
but narrower: the provider is called exactly **twice** per investigation —
`plan()` once, up front, to get an ordered list of tool-call steps and which
candidate hypotheses are worth considering, and `narrate()` once, at the
end, to phrase the already-decided findings in prose. Everything between
those two calls — executing the plan's tool calls, generating hypotheses,
scoring evidence, ranking root causes — is deterministic code, not
model-driven turn-by-turn decisions.

**Why:** the brief is equally explicit that hypothesis status and
confidence must never be something "the LLM arbitrarily sets," and that the
whole system must be testable without network access or credentials. A
free-form multi-turn loop against a real model can't satisfy both — its
behavior isn't reproducible enough to evaluate deterministically, and it
would make "run 5 fixed scenarios and check the exact root cause" nearly
impossible to guarantee. Two bounded, structured calls keep the model's
influence scoped to what it's good at (proposing what to look at, writing
the explanation) while everything with a "right answer" is code. The
`runtime/loop.ts` executor still satisfies the bounded-loop requirement
(hard `maxSteps` cap, per-step validate/execute/store, tool failures become
structured results instead of crashing) — it just isn't re-consulting the
model between steps, because the steps were all decided in the one
planning call.

## Zero-dependency deterministic provider as the default

`DeterministicProvider` implements the exact same `LLMProvider` interface
as the real Anthropic adapter: it always proposes the same canonical plan
(every registered tool, in a sensible order) and considers every catalog
hypothesis worth investigating. It has no "opinion" — the outcome for any
given scenario comes entirely from what the deterministic verifier finds in
the real tool data, not from anything scenario-specific baked into the
provider.

**Why:** this is what makes PaySherlock runnable, testable, and evaluable
with zero setup — no API key, no network call, no flaky/non-reproducible
model output. It's also _why_ the same provider works correctly across all
5 evaluation scenarios (which have very different correct answers) without
any per-scenario scripting: the provider's behavior is constant, only the
underlying payment data changes, exactly like a real analyst following a
fixed checklist would.

## Fixed 5-hypothesis catalog + deterministic threshold rules

`hypotheses/catalog.ts` defines exactly 5 hypotheses
(`upi_failure_increase`, `transaction_volume_decline`, `refund_spike`,
`payment_method_degradation`, `high_value_decline`). Each has a dedicated,
documented threshold rule in `hypotheses/rules.ts` that reads only from
real tool output (`evidence/findings.ts`) and returns `SUPPORTED` /
`REJECTED` / `INCONCLUSIVE`. Confidence (`evidence/scorer.ts`) is a
function of evidence _significance tags_, never a number the provider
supplies.

**Why:** this is the concrete mechanism behind "don't let the LLM
arbitrarily set confidence=91%." A hypothesis is never SUPPORTED because a
model said so — it's SUPPORTED because, e.g., the overall failure rate rose
≥3 percentage points _and_ UPI accounts for ≥50% of failures, both read
directly from `get_payment_failures`' output. The thresholds themselves are
judgment calls (documented inline in `rules.ts`) — reasonable starting
points for a Buildathon MVP, not statistically derived, and worth revisiting
with real merchant data later.

## Root cause = highest-scoring SUPPORTED hypothesis, or none

`output/result.ts`'s `selectRootCause` picks the SUPPORTED hypothesis with
the highest `score` (confidence + a small evidence-count tiebreaker). If no
hypothesis reaches SUPPORTED, the result has no `rootCause` and the summary
says so explicitly — this is Scenario E's "no significant anomaly detected"
path, and it is a first-class outcome, not a fallback/error.

## Duration-scaling baselines: a real bug found and fixed while building the evaluation harness

`compare_periods` and `calculate_revenue_impact` were built from the start
to scale a differently-sized baseline (e.g. "preceding 7 days") to the
current window's duration before comparing — otherwise a 1-day current
window compared against a raw 7-day baseline total always looks like a
huge decline, regardless of any real anomaly. While building the 5
evaluation scenarios, we discovered `segment_payments` and `get_refunds`
had the _same_ unscaled-baseline problem and hadn't been caught by their
unit tests (which happened to use equal-length windows). Both were fixed to
scale baseline counts/amounts the same way, and their tests were updated to
cover a differently-sized baseline explicitly. This is the main reason the
evaluation harness — which exercises the full pipeline against realistic
1-day-vs-7-day windows — is worth having even with 100% unit test coverage
of individual tools: it caught an integration-level bug unit tests couldn't.

## Evaluation harness: a tiny in-memory fake database, not hand-mocked Prisma calls

`eval/fakeDatabase.ts` implements the exact call shapes
`packages/database`'s analytics functions use
(`aggregate`/`groupBy`/`findMany` with `where`/`by`/`select`/`take`)
against plain in-memory arrays of synthetic `FakePayment`/`FakeRefund`
rows, computing the same aggregates Postgres would. Each of the 5 scenarios
is then just a list of synthetic rows (`eval/scenarios.ts`), generated with
`eval/generators.ts`'s deterministic (no-randomness) helpers.

**Why:** hand-writing every `mockResolvedValueOnce` call for an 8-step
investigation (which internally issues ~15 distinct Prisma calls across
`get_payments`, `compare_periods`, `get_payment_failures`,
`segment_payments` ×2, `analyze_failure_codes`, `get_refunds`,
`calculate_revenue_impact`) is both extremely fragile and doesn't actually
exercise the aggregation logic. The fake database is a one-time investment
that made 5 realistic scenarios tractable to build and — critically — is
what surfaced the duration-scaling bug above by computing real (if
synthetic) aggregates instead of pre-computed canned numbers.

## Merchant isolation: `ToolContext`, never tool input

Every tool handler's function signature is `(input, ctx) => Output`, where
`input` is the zod-validated, _model-influenced_ argument object and `ctx`
(`{ merchantId, db }`) is supplied entirely by the trusted application
layer. No tool's `inputSchema` has a `merchantId` field at all — there is
no field for a compromised or careless plan to populate. `apps/api`'s
`POST /investigations` route derives the merchant via
`resolveMerchant(deps.db, {})` server-side and never reads a merchant id
from the request body. See `runtime/agent.ts::runInvestigation`, which
always constructs `ctx` from `request.merchantId` (itself always
server-supplied — see `routes/investigations.ts`), never from anything the
plan proposes.

## Anthropic provider: hand-rolled REST client, same rationale as Razorpay

`AnthropicProvider` calls the Messages API directly via `fetch` with
forced tool-use for structured output, rather than depending on the
official `@anthropic-ai/sdk`. Same reasoning as the Phase 1 Razorpay
adapter ADR: minimal dependency surface, full control over typed
request/response shapes, and it's isolated behind the `LLMProvider`
interface so swapping to the official SDK later touches only this one file.
It is not exercised by the automated test suite — no test makes a network
call — and is only reachable when `AI_PROVIDER=anthropic` with real
`AI_MODEL`/`AI_API_KEY` configured.

## Currency formatting only at the boundary

`output/formatter.ts::formatMinorUnitsAsINR` is the _only_ place a minor-unit
integer becomes a "₹1.72L"-style string, and it's used exclusively when
building the natural-language facts handed to `provider.narrate()` — the
`InvestigationResult.businessImpact.estimatedImpactMinorUnits` field itself
stays an integer. This mirrors the Phase 1 money-representation decision:
compute and store in minor units everywhere, format only for a human to
read.
