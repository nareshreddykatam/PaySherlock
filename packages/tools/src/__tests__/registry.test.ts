import { describe, expect, it, vi } from "vitest";
import { z } from "zod";
import { executeTool, ToolRegistry } from "../registry.js";
import type { ToolDefinition } from "../types.js";
import { createMockDb, createToolContext } from "./fixtures.js";

const echoTool: ToolDefinition<{ value: number }, { doubled: number }> = {
  name: "echo_double",
  description: "test tool",
  inputSchema: z.object({ value: z.number() }),
  outputSchema: z.object({ doubled: z.number() }),
  handler: async (input) => ({ doubled: input.value * 2 }),
};

function buildRegistry() {
  const registry = new ToolRegistry();
  registry.register(echoTool);
  return registry;
}

describe("ToolRegistry", () => {
  it("rejects registering the same tool name twice", () => {
    const registry = buildRegistry();
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
  });

  it("exposes a safe catalog (name + description only)", () => {
    const registry = buildRegistry();
    expect(registry.catalog()).toEqual([{ name: "echo_double", description: "test tool" }]);
  });
});

describe("executeTool", () => {
  const ctx = createToolContext(createMockDb());

  it("rejects an unregistered tool without throwing", async () => {
    const registry = buildRegistry();
    const result = await executeTool(registry, "call-1", "does_not_exist", {}, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Unknown tool/);
  });

  it("rejects invalid input without calling the handler", async () => {
    const registry = buildRegistry();
    const handlerSpy = vi.spyOn(echoTool, "handler");
    const result = await executeTool(
      registry,
      "call-2",
      "echo_double",
      { value: "not a number" },
      ctx,
    );
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/Invalid input/);
    expect(handlerSpy).not.toHaveBeenCalled();
  });

  it("returns a structured error (not a thrown exception) when the handler throws", async () => {
    const registry = new ToolRegistry();
    registry.register<{ value: number }, { doubled: number }>({
      ...echoTool,
      name: "throwing_tool",
      handler: async () => {
        throw new Error("boom");
      },
    });
    const result = await executeTool(registry, "call-3", "throwing_tool", { value: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toBe("boom");
  });

  it("rejects a handler result that doesn't match the output schema", async () => {
    const registry = new ToolRegistry();
    registry.register<{ value: number }, { doubled: number }>({
      ...echoTool,
      name: "bad_output_tool",
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      handler: async () => ({ doubled: "not a number" }) as any,
    });
    const result = await executeTool(registry, "call-4", "bad_output_tool", { value: 1 }, ctx);
    expect(result.success).toBe(false);
    expect(result.error).toMatch(/invalid result/);
  });

  it("returns validated, structured output on success", async () => {
    const registry = buildRegistry();
    const result = await executeTool(registry, "call-5", "echo_double", { value: 21 }, ctx);
    expect(result).toMatchObject({ success: true, output: { doubled: 42 } });
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });
});
