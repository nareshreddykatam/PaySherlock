import type { FastifyInstance } from "fastify";
import { runTrack03Evaluation } from "../eval/runTrack03Evaluation.js";

/**
 * Track 03 (AI Revenue Recovery): exposes the same offline evaluation
 * harness `pnpm eval:track03` runs (docs/evaluation/track03-report.json)
 * over HTTP, so the frontend's "Synthetic Track 03 Evaluation" panel always
 * reads a freshly computed, reproducible number instead of a constant
 * duplicated into the UI. Read-only, takes no input, resolves no merchant,
 * and never calls a live Razorpay API — see runTrack03Evaluation.ts's own
 * disclosure, which is passed straight through in the response.
 */
export function registerEvaluationRoutes(app: FastifyInstance): void {
  app.get("/eval/track03", async () => {
    const report = await runTrack03Evaluation();
    return {
      generatedAt: report.generatedAt,
      environment: report.environment,
      metrics: report.metrics,
      scenariosPassed: report.scenarios.filter((scenario) => scenario.passed).length,
      scenariosTotal: report.scenarios.length,
      limitations: report.limitations,
    };
  });
}
