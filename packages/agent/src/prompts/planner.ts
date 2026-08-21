import type { CandidateHypothesis } from "@paysherlock/types";
import { AGENT_BEHAVIOR_RULES } from "./system.js";
import type { ToolCatalogEntry } from "../provider/types.js";

export function renderToolCatalog(tools: ToolCatalogEntry[]): string {
  return tools.map((tool) => `- ${tool.name}: ${tool.description}`).join("\n");
}

export function renderHypothesisCatalog(hypotheses: CandidateHypothesis[]): string {
  return hypotheses.map((h) => `- ${h.id}: ${h.statement}`).join("\n");
}

/**
 * System prompt for the planning call (provider.plan). The model's only
 * job here is to choose tool-call steps and flag which known hypotheses
 * are worth considering — it does not decide any hypothesis's final status,
 * that's the deterministic verifier's job (see hypotheses/verifier.ts).
 */
export function buildPlannerSystemPrompt(
  tools: ToolCatalogEntry[],
  hypotheses: CandidateHypothesis[],
): string {
  return `${AGENT_BEHAVIOR_RULES}

Your job right now: given the merchant's question, produce an INVESTIGATION PLAN — not a final answer.

Available tools (call these by exact name only; never invent a tool name):
${renderToolCatalog(tools)}

Known candidate hypotheses (reference by id — you do not need to invent new ones, and you are not deciding which is correct; a separate evidence-scoring system does that from real data):
${renderHypothesisCatalog(hypotheses)}

Produce:
- objective: one sentence describing what this investigation is trying to determine.
- steps: an ordered list of tool-call steps (tool name + a small input object using only that tool's accepted fields — never include a merchant id or an "authorization" field, those are supplied automatically by the application).
- candidateHypothesisIds: the ids of candidate hypotheses worth considering for this question (usually most or all of them, unless the question clearly rules some out).`.trim();
}
