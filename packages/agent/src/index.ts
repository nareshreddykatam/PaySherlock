// @paysherlock/agent — the AI investigation engine. The LLM only ever sees
// structured tool results and structured facts through this package; it
// never touches Postgres, Razorpay credentials, or a financial action
// directly. See docs/architecture and docs/decisions.

export * from "./provider/types.js";
export * from "./provider/deterministicProvider.js";
export * from "./provider/anthropicProvider.js";
export * from "./provider/factory.js";

export * from "./planner/planner.js";
export * from "./planner/defaultSteps.js";

export * from "./hypotheses/catalog.js";
export * from "./hypotheses/generator.js";
export * from "./hypotheses/verifier.js";

export * from "./evidence/findings.js";
export * from "./evidence/scorer.js";

export * from "./output/result.js";
export * from "./output/formatter.js";

export * from "./runtime/context.js";
export * from "./runtime/loop.js";
export * from "./runtime/agent.js";
export * from "./runtime/runner.js";
export * from "./runtime/snapshot.js";

// Synthetic (non-real, non-customer) test infrastructure — exported so
// other packages/apps' own evaluation harnesses (e.g. apps/api's Phase 4
// proactive-flow evaluation) can build on the same fake database instead of
// each hand-rolling a second one. See docs/decisions.
export * from "./eval/fakeDatabase.js";
export * from "./eval/generators.js";
