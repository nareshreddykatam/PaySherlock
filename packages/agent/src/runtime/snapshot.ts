import { createToolRegistry, type Database, type ToolRegistry } from "@paysherlock/tools";
import type { Evidence, Hypothesis, TimeRange, ToolResult } from "@paysherlock/types";
import { DEFAULT_INVESTIGATION_STEPS } from "../planner/defaultSteps.js";
import { HYPOTHESIS_CATALOG } from "../hypotheses/catalog.js";
import { generateHypotheses } from "../hypotheses/generator.js";
import { verifyHypotheses } from "../hypotheses/verifier.js";
import { extractFindings, type Findings } from "../evidence/findings.js";
import {
  generateInvestigationId,
  resolveDefaultToolArgs,
  type DefaultToolArgs,
} from "./context.js";
import { runToolPlan } from "./loop.js";

export interface SnapshotParams {
  merchantId: string;
  db: Database;
  timeRange?: TimeRange;
  /** Reuse a registry across calls if the caller has one; otherwise a
   * fresh one is built (cheap, stateless). */
  registry?: ToolRegistry;
}

export interface DeterministicSnapshot {
  timeRange: DefaultToolArgs;
  toolResults: ToolResult[];
  findings: Findings;
  hypotheses: Hypothesis[];
  evidence: Evidence[];
}

/**
 * Runs the same deterministic tool-execution + hypothesis-verification
 * pipeline the investigation engine uses (see runtime/agent.ts), but skips
 * the LLM `plan()`/`narrate()` calls entirely — there's no merchant
 * question to plan around here, and no prose to write. This is what
 * apps/api's `GET /overview` uses to power the Overview/Issues surfaces
 * from real, current data: it reuses the exact same tool registry, default
 * step sequence, and hypothesis catalog/verifier as a real investigation,
 * it just runs synchronously once per request rather than as background
 * monitoring (there is no autonomous monitoring in this phase).
 */
export async function runDeterministicSnapshot(
  params: SnapshotParams,
): Promise<DeterministicSnapshot> {
  const registry = params.registry ?? createToolRegistry();
  const timeRange = resolveDefaultToolArgs({ timeRange: params.timeRange });

  const { toolResults } = await runToolPlan({
    investigationId: generateInvestigationId(),
    steps: DEFAULT_INVESTIGATION_STEPS,
    registry,
    ctx: { merchantId: params.merchantId, db: params.db },
    defaultArgs: timeRange,
    maxSteps: DEFAULT_INVESTIGATION_STEPS.length,
  });

  const findings = extractFindings(toolResults);
  const pending = generateHypotheses(HYPOTHESIS_CATALOG);
  const { hypotheses, evidence } = verifyHypotheses(pending, findings);

  return { timeRange, toolResults, findings, hypotheses, evidence };
}
