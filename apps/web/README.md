# apps/web — Investigation Command Center

**Status:** Phase 4 — implemented.

The merchant-facing frontend: a Next.js (App Router) app that surfaces
PaySherlock's real AI investigation engine (`packages/agent`, via
`apps/api`) rather than a generic payment dashboard with a chatbox bolted
on. As of Phase 4, the Issues page shows real, persisted anomaly `Issue`
records (`packages/detection`) rather than only the Overview's ephemeral
snapshot, each with a detail page reusing the same evidence/hypothesis
components the Investigate flow uses. See
[`docs/architecture`](../../docs/architecture) for the full data flow and
[`docs/decisions/0003`](../../docs/decisions/0003-investigation-command-center.md)/
[`0004`](../../docs/decisions/0004-proactive-payment-intelligence.md) for
the reasoning behind the UX and API-integration decisions.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript (strict) ·
Tailwind CSS v4 (CSS-first `@theme` config, no `tailwind.config.js`) ·
Radix UI primitives (dialog/tabs/tooltip) for accessible dialogs and
drawers · Vitest + Testing Library for component tests.

## Local setup

```bash
pnpm install
cp apps/web/.env.example apps/web/.env.local   # set NEXT_PUBLIC_API_URL
pnpm --filter @paysherlock/web dev             # http://localhost:3000
```

Requires `apps/api` running (see the root [README](../../README.md)) at
the URL configured in `NEXT_PUBLIC_API_URL` (default
`http://localhost:4000`). Without a live backend/database, every
data-driven page still renders — it shows its real, honest error state
(no fabricated numbers) rather than crashing, because every API failure
path is exercised by design.

## Scripts

`dev` · `build` · `start` · `typecheck` · `lint` · `test` — same
Turborepo-driven conventions as every other workspace package (see
[`AGENTS.md`](../../AGENTS.md)).

## Structure

```
app/            Route segments — Overview (/), /investigate, /payments,
                /issues, /issues/[id], /history — each a client component
components/     ui/ (design-system primitives), layout/ (shell/sidebar/
                header), investigation/, payments/, issues/, dashboard/,
                notifications/ (in-app issue toasts)
lib/api/        Typed API client — apiFetch() + per-resource functions,
                every response validated against a zod schema before use
lib/formatters/ Currency (INR), date, payment-method, and issue formatting
lib/history/    sessionStorage-backed investigation history (session-only)
lib/notifications/ Polls GET /issues for new/escalated issues, deduped via
                sessionStorage — in-app only, no email/Slack/SMS
__tests__/      Component tests — navigation, investigation form, API
                error handling, result/evidence/hypothesis rendering,
                empty states, payments table, issues list/detail, notifications
```

## What this app deliberately does not do

No scheduled investigations (detection itself is scheduled server-side by
`workers/investigator`, but this app only ever displays results — it never
triggers a detection run), refunds, payment capture, payment links,
merchant approval workflows, or production authentication — all out of
scope for this phase (see the root README's roadmap). "Settings" in the
sidebar is an intentional non-functional placeholder. Investigation
"follow-ups" are new, independent `POST /investigations` calls with a
prefilled question, not a multi-turn conversation — there is no
server-side investigation memory to build one on top of. In-app
notifications only (no email/Slack/WhatsApp/SMS), deduped per browser
session — not a persisted, server-tracked notification ledger.
