import type { Database, ToolRegistry } from "@paysherlock/tools";
import type { InvestigationRequest, InvestigationResult } from "@paysherlock/types";
import type { LLMProvider } from "../provider/types.js";
import { runInvestigation } from "./agent.js";
import type { ToolCallLogEntry } from "./context.js";

export interface InvestigationRunnerConfig {
  provider: LLMProvider;
  registry: ToolRegistry;
  maxSteps?: number;
  onToolCall?: (entry: ToolCallLogEntry) => void;
}

export type InvestigationRunner = (
  request: InvestigationRequest,
  db: Database,
) => Promise<InvestigationResult>;

/** Binds a provider/registry/step-limit once, returning a plain
 * `(request, db) => InvestigationResult` function — the shape apps/api
 * injects into its server so route handlers don't need to know about
 * providers or tool registries at all. */
export function createInvestigationRunner(config: InvestigationRunnerConfig): InvestigationRunner {
  return (request, db) =>
    runInvestigation({
      request,
      provider: config.provider,
      registry: config.registry,
      db,
      maxSteps: config.maxSteps,
      onToolCall: config.onToolCall,
    });
}
