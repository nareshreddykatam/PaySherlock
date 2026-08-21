import { executeTool, type ToolContext, type ToolRegistry } from "@paysherlock/tools";
import type { InvestigationStep, ToolResult } from "@paysherlock/types";
import { summarizeToolInput, type ToolCallLogEntry } from "./context.js";
import type { DefaultToolArgs } from "./context.js";

export interface RunToolPlanParams {
  investigationId: string;
  steps: InvestigationStep[];
  registry: ToolRegistry;
  ctx: ToolContext;
  defaultArgs: DefaultToolArgs;
  maxSteps: number;
  /** Optional sink for safe, privacy-conscious observability records — see
   * runtime/context.ts. Never receives secrets or raw chain-of-thought. */
  onStep?: (entry: ToolCallLogEntry) => void;
}

export interface RunToolPlanResult {
  toolResults: ToolResult[];
  stepsExecuted: number;
  /** True if the plan had more steps than `maxSteps` allowed — the
   * investigation still completes with whatever evidence was gathered. */
  truncated: boolean;
}

/**
 * The bounded investigation loop (Phase 2 brief, section 12): executes the
 * plan's tool-call steps in order, validating and running each through the
 * tool registry, storing every result (success or structured failure) and
 * never exceeding `maxSteps`. A tool never throws out of `executeTool` — a
 * bad step just becomes a failed ToolResult, and the loop continues so one
 * bad call can't abort the whole investigation.
 */
export async function runToolPlan(params: RunToolPlanParams): Promise<RunToolPlanResult> {
  const boundedSteps = params.steps.slice(0, params.maxSteps);
  const toolResults: ToolResult[] = [];

  for (let index = 0; index < boundedSteps.length; index += 1) {
    const step = boundedSteps[index]!;
    const stepNumber = index + 1;
    const callId = `${params.investigationId}_step${stepNumber}`;
    // Defaults first, then the plan step's own input — a step can override
    // the default window, but merchant scoping is never part of `input` at
    // all (it lives on `ctx`, injected separately below).
    const mergedInput = { ...params.defaultArgs, ...step.input };

    const startedAt = Date.now();
    const result = await executeTool(params.registry, callId, step.tool, mergedInput, params.ctx);
    toolResults.push(result);

    params.onStep?.({
      investigationId: params.investigationId,
      stepNumber,
      tool: step.tool,
      inputSummary: summarizeToolInput(mergedInput),
      success: result.success,
      error: result.success ? undefined : result.error,
      durationMs: Date.now() - startedAt,
    });
  }

  return {
    toolResults,
    stepsExecuted: boundedSteps.length,
    truncated: params.steps.length > params.maxSteps,
  };
}
