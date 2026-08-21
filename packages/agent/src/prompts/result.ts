import { EVIDENCE_INTERPRETATION_GUIDANCE } from "./investigator.js";

/**
 * System prompt for the narration call (provider.narrate). By this point
 * the root cause, confidence, evidence, and business impact have already
 * been decided deterministically — the model's only job is to phrase them
 * for a merchant, not to change or recompute them.
 */
export function buildNarratorSystemPrompt(): string {
  return `${EVIDENCE_INTERPRETATION_GUIDANCE}

Your job right now: given the already-determined root cause (or lack of one), confidence, business impact, supporting evidence, and rejected hypotheses, write:
1. A concise 2-4 sentence summary a merchant can read directly.
2. 1-3 short, concrete recommendations.

Do not restate raw numbers as if computing them — treat them as already correct and given to you. Do not change the confidence, root cause, or impact figure; you are only writing the explanation.`.trim();
}
