import type { ToolResult } from "@paysherlock/types";
import type { AnyToolDefinition, ToolContext, ToolDefinition } from "./types.js";

/**
 * The only set of tools the agent is allowed to call. Anything not
 * registered here is rejected by `executeTool` — the model can request a
 * tool by name, but it can never cause code it wasn't given access to run.
 */
export class ToolRegistry {
  private readonly tools = new Map<string, AnyToolDefinition>();

  register<TInput, TOutput>(tool: ToolDefinition<TInput, TOutput>): void {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool "${tool.name}" is already registered`);
    }
    this.tools.set(tool.name, tool as AnyToolDefinition);
  }

  has(name: string): boolean {
    return this.tools.has(name);
  }

  get(name: string): AnyToolDefinition | undefined {
    return this.tools.get(name);
  }

  list(): AnyToolDefinition[] {
    return [...this.tools.values()];
  }

  /** Safe-to-show-the-model view: name + description only, never handler
   * internals or the database. */
  catalog(): { name: string; description: string }[] {
    return this.list().map((tool) => ({ name: tool.name, description: tool.description }));
  }
}

/**
 * Executes one tool call end-to-end: reject unknown tools, validate input,
 * run the handler, validate output — never throwing. A tool failure (bad
 * input, bad output, or a handler error) becomes a structured
 * `ToolResult.success === false`, so the agent loop can continue instead
 * of crashing on one bad call.
 */
export async function executeTool(
  registry: ToolRegistry,
  callId: string,
  name: string,
  rawInput: unknown,
  ctx: ToolContext,
): Promise<ToolResult> {
  const startedAt = Date.now();
  const tool = registry.get(name);
  if (!tool) {
    return {
      id: callId,
      tool: name,
      success: false,
      error: `Unknown tool "${name}" — not in the registered tool catalog`,
      durationMs: Date.now() - startedAt,
    };
  }

  const parsedInput = tool.inputSchema.safeParse(rawInput ?? {});
  if (!parsedInput.success) {
    return {
      id: callId,
      tool: name,
      success: false,
      error: `Invalid input for "${name}": ${describeIssues(parsedInput.error.issues)}`,
      durationMs: Date.now() - startedAt,
    };
  }

  try {
    const output = await tool.handler(parsedInput.data, ctx);
    const parsedOutput = tool.outputSchema.safeParse(output);
    if (!parsedOutput.success) {
      return {
        id: callId,
        tool: name,
        success: false,
        error: `Tool "${name}" produced an invalid result: ${describeIssues(parsedOutput.error.issues)}`,
        durationMs: Date.now() - startedAt,
      };
    }
    return {
      id: callId,
      tool: name,
      success: true,
      output: parsedOutput.data,
      durationMs: Date.now() - startedAt,
    };
  } catch (error) {
    return {
      id: callId,
      tool: name,
      success: false,
      error: error instanceof Error ? error.message : String(error),
      durationMs: Date.now() - startedAt,
    };
  }
}

function describeIssues(issues: { path: PropertyKey[]; message: string }[]): string {
  return issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; ");
}
