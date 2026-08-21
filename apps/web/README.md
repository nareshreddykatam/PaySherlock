# apps/web — Merchant Dashboard (planned)

**Status:** not yet scaffolded (Phase 0).

This app will hold the merchant-facing dashboard and frontend, planned as a
**Next.js** app using **Tailwind CSS** and **shadcn/ui**.

Scaffolding a real frontend framework here is deferred to a later phase so
that Phase 0 does not pull in application-level dependencies or pages ahead
of schedule. When this app is created, wire it into the pnpm workspace (it is
already covered by the `apps/*` glob in [`pnpm-workspace.yaml`](../../pnpm-workspace.yaml))
and add `dev`/`build`/`lint`/`typecheck` scripts consistent with the other
workspace packages so Turborepo picks it up automatically.
