import type { Database } from "@paysherlock/database";
import type { z } from "zod";

// Re-exported so consumers (e.g. packages/agent) can construct/type a
// ToolContext without taking a direct dependency on @paysherlock/database
// themselves — the database package stays reachable only through tools.
export type { Database } from "@paysherlock/database";

/**
 * Trusted execution context for a tool call. `merchantId` is always
 * supplied by the application layer (never by the model/tool input) — see
 * docs/decisions for the tenant-isolation rationale. Every tool handler
 * must scope its database access using this, not anything from its input.
 */
export interface ToolContext {
  merchantId: string;
  db: Database;
}

export interface ToolDefinition<TInput = unknown, TOutput = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<TInput>;
  outputSchema: z.ZodType<TOutput>;
  handler: (input: TInput, ctx: ToolContext) => Promise<TOutput>;
}

/** Type-erased view used by the registry/catalog — concrete tool modules
 * keep their own strong input/output types. */
export type AnyToolDefinition = ToolDefinition<unknown, unknown>;
