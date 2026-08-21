# AGENTS.md — Instructions for Coding Agents Working on PaySherlock

## What PaySherlock Is

PaySherlock is an AI agent that investigates payment and revenue problems for
merchants. Core principle: **don't just show merchants what happened —
investigate why it happened.** It is a software system that _contains_ an AI
agent, not a chatbot wrapper around a dashboard.

## Repository Structure

```
apps/web           Merchant dashboard / frontend (Next.js — not yet scaffolded)
apps/api            Backend/API service
packages/agent      AI agent runtime and orchestration
packages/tools       Explicit typed tools the agent calls
packages/razorpay   Razorpay integration adapter
packages/database   Database client/schema layer (Prisma + PostgreSQL)
packages/types       Shared TypeScript types
packages/ui          Shared UI components
workers/investigator Background investigation/processing worker (BullMQ)
docs/                Architecture, product, and decision records
scripts/             Repo-level scripts
```

This is a pnpm + Turborepo monorepo. `packages/database`, `packages/razorpay`,
`packages/types`, `packages/tools`, `packages/agent`, and `apps/api` are
implemented (Phases 0–2). `apps/web`, `packages/ui`, and
`workers/investigator` are still placeholders.

## Architecture Principles

1. **AI is not the application.** Never build around a giant prompt. The
   agent interacts with the rest of the system through explicit, typed tools
   in `packages/tools`.
2. **Tool-based agent.** Future tools (`get_payments`, `calculate_success_rate`,
   `detect_anomalies`, etc.) are typed functions with clear contracts, not
   free-form prompt instructions.
3. **Razorpay adapter boundary.** Nothing outside `packages/razorpay` may
   depend on Razorpay-specific types or API shapes. The rest of the app talks
   to a generic payment-provider interface.
4. **Financial safety.** No AI model gets unrestricted access to financial
   actions. Every money- or customer-state-affecting action must flow through:
   recommendation → policy/guardrail check → merchant approval → execution →
   audit log.
5. **Evidence-backed AI.** Investigation conclusions must cite structured
   evidence (metrics, deltas, correlations) — never a bare causal claim.
6. **Auditability.** Design new systems so agent runs, tool calls, evidence,
   recommendations, approvals, and outcomes can be traced. (Full audit system
   is implemented in a later phase.)
7. **No chain-of-thought exposure.** The UI shows investigation status,
   concise reasoning summaries, evidence, hypotheses, and decisions — never
   raw hidden model reasoning.

## Coding Conventions

- TypeScript everywhere, `strict: true` (see `tsconfig.base.json`).
- Each package extends the root `tsconfig.base.json` and builds independently.
- No comments explaining _what_ code does — only non-obvious _why_.
- Don't add abstractions, config options, or error handling for cases that
  can't happen. Keep changes scoped to what's asked.
- Format with Prettier, lint with ESLint (flat config, `eslint.config.js`).
- `apps/api` uses Fastify; input validation uses zod. Database access goes
  through `packages/database`'s query/upsert functions, which accept a
  `Database` client as a parameter (never a module-level singleton) so
  they're testable without a live Postgres — see
  [docs/decisions/0001](docs/decisions/0001-payment-data-foundation.md).

## Security Requirements

- Never commit secrets. Use `.env` (gitignored); `.env.example` holds
  placeholders only.
- Server-side secrets (Razorpay keys, AI API keys, DB credentials) must never
  reach frontend bundles.
- Never disable TLS/security checks or bypass authentication for convenience.

## Financial Safety Requirements

- No code path may execute a financial action (transfer, refund, payout,
  trade) without going through the guardrail → merchant-approval → audit-log
  flow described above. This applies even to seemingly low-risk actions.
- Do not give the agent direct, unmediated write access to payment provider
  mutation endpoints.

## Testing Expectations

- Tests run with Vitest (`pnpm test`, per-package `vitest.config.ts`). New
  logic should be accompanied by unit tests.
- Razorpay adapter code requires tests against mocked/sandboxed responses,
  never live financial calls (mock `fetch`, never hit `api.razorpay.com` in
  tests).
- Database query/upsert functions are tested against a mocked `Database`
  client, not a live Postgres (no Postgres is provisioned for this repo yet).
- Agent/tool code requires tests that assert on tool inputs/outputs, not on
  raw model output.

## Razorpay Integration Boundary

All Razorpay SDK/API usage lives in `packages/razorpay` behind an interface
the rest of the app depends on. Adding a new payment provider later should
not require changes outside that package and its interface consumers.

## AI Agent Boundaries

- LLM access goes through a provider-independent adapter (`AI_PROVIDER` env
  var selects the implementation — `packages/agent/src/provider/factory.ts`).
  Do not hardcode calls to a single provider's SDK outside that adapter.
- Agent code lives in `packages/agent`; it orchestrates calls to
  `packages/tools`, it does not embed business logic that belongs in tools.
- The LLM proposes (which tools to call, which hypotheses to consider) and
  narrates (summary/recommendations text) — it never decides a hypothesis's
  status or confidence. That's `hypotheses/verifier.ts` +
  `evidence/scorer.ts`, driven entirely by real tool output. Do not add a
  code path where a provider's output directly sets `confidence`,
  `status`, or `businessImpact` — those must always be computed.
- Every tool's `ToolContext.merchantId` comes from the trusted server-side
  request, never from the model/plan's input. Do not add a `merchantId`
  field to any tool's `inputSchema`.
- The agent loop (`runtime/loop.ts`) is hard-bounded by `maxSteps`
  (`MAX_AGENT_STEPS` env var). A tool failure becomes a structured
  `ToolResult` with `success: false` — tools/the loop must never throw past
  `executeTool`.
- Tests and the evaluation harness (`packages/agent/src/eval/`) always use
  `DeterministicProvider`, never a real provider — see
  [docs/decisions/0002](docs/decisions/0002-ai-investigation-engine.md).

## Git Conventions

- Conventional-style commit subjects (`chore:`, `feat:`, `fix:`, `docs:`).
- Do not force-push shared branches. Do not amend published commits.
- Do not commit `.env` or any file containing real credentials.

## Forbidden Practices

- Fake/demo data standing in for real integrations.
- Unrestricted or "convenience" financial actions.
- Tight coupling to a single AI provider or to Razorpay outside its adapter.
- Exposing model chain-of-thought in the UI.
- Overengineering: unnecessary microservices, premature event buses, empty
  packages created "just in case."
