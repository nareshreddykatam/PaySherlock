import { describe, expect, it } from "vitest";
import { z } from "zod";
import { ToolRegistry } from "@paysherlock/tools";
import type { InvestigationStep } from "@paysherlock/types";
import { runToolPlan } from "../runtime/loop.js";
import type { ToolCallLogEntry } from "../runtime/context.js";

function buildRegistry() {
  const registry = new ToolRegistry();
  registry.register({
    name: "always_succeeds",
    description: "test",
    inputSchema: z.object({}),
    outputSchema: z.object({ ok: z.literal(true) }),
    handler: async () => ({ ok: true as const }),
  });
  registry.register({
    name: "always_throws",
    description: "test",
    inputSchema: z.object({}),
    outputSchema: z.object({}),
    handler: async () => {
      throw new Error("simulated tool failure");
    },
  });
  return registry;
}

const ctx = { merchantId: "merchant-1", db: {} as never };
const defaultArgs = {
  startTime: "2026-08-20T00:00:00.000Z",
  endTime: "2026-08-21T00:00:00.000Z",
  baselineStartTime: "2026-08-13T00:00:00.000Z",
  baselineEndTime: "2026-08-20T00:00:00.000Z",
};

describe("runToolPlan", () => {
  it("never exceeds maxSteps even when the plan has more steps (bounded loop)", async () => {
    const registry = buildRegistry();
    const steps: InvestigationStep[] = Array.from({ length: 10 }, () => ({
      tool: "always_succeeds",
      input: {},
    }));

    const result = await runToolPlan({
      investigationId: "inv_test",
      steps,
      registry,
      ctx,
      defaultArgs,
      maxSteps: 3,
    });

    expect(result.stepsExecuted).toBe(3);
    expect(result.toolResults).toHaveLength(3);
    expect(result.truncated).toBe(true);
  });

  it("records an unregistered tool as a failed result and continues to the next step", async () => {
    const registry = buildRegistry();
    const steps: InvestigationStep[] = [
      { tool: "does_not_exist", input: {} },
      { tool: "always_succeeds", input: {} },
    ];

    const result = await runToolPlan({
      investigationId: "inv_test",
      steps,
      registry,
      ctx,
      defaultArgs,
      maxSteps: 10,
    });

    expect(result.toolResults[0]).toMatchObject({ success: false });
    expect(result.toolResults[1]).toMatchObject({ success: true });
  });

  it("captures a tool handler's thrown error as a structured failure, not an unhandled rejection", async () => {
    const registry = buildRegistry();
    const result = await runToolPlan({
      investigationId: "inv_test",
      steps: [{ tool: "always_throws", input: {} }],
      registry,
      ctx,
      defaultArgs,
      maxSteps: 10,
    });

    expect(result.toolResults[0]).toMatchObject({
      success: false,
      error: "simulated tool failure",
    });
  });

  it("emits a safe observability record per step, with no raw secrets and errors only on failure", async () => {
    const registry = buildRegistry();
    const entries: ToolCallLogEntry[] = [];

    await runToolPlan({
      investigationId: "inv_test",
      steps: [
        { tool: "always_succeeds", input: {} },
        { tool: "always_throws", input: {} },
      ],
      registry,
      ctx,
      defaultArgs,
      maxSteps: 10,
      onStep: (entry) => entries.push(entry),
    });

    expect(entries).toHaveLength(2);
    expect(entries[0]).toMatchObject({ tool: "always_succeeds", success: true, error: undefined });
    expect(entries[1]).toMatchObject({ tool: "always_throws", success: false });
    expect(entries[1]!.error).toBe("simulated tool failure");
  });

  it("merges the trusted default time-range args into each step's input", async () => {
    const registry = new ToolRegistry();
    let receivedInput: unknown;
    registry.register({
      name: "capture_input",
      description: "test",
      inputSchema: z.object({}).passthrough(),
      outputSchema: z.object({}).passthrough(),
      handler: async (input) => {
        receivedInput = input;
        return {};
      },
    });

    await runToolPlan({
      investigationId: "inv_test",
      steps: [{ tool: "capture_input", input: { dimension: "method" } }],
      registry,
      ctx,
      defaultArgs,
      maxSteps: 10,
    });

    expect(receivedInput).toMatchObject({ ...defaultArgs, dimension: "method" });
  });
});
