import { AGENT_BEHAVIOR_RULES } from "./system.js";

/**
 * Shared guidance for any step where the model interprets *already
 * computed* evidence rather than raw data — currently used by the narrator
 * (prompts/result.ts), and kept separate from planner.ts so "how to reason
 * about evidence" isn't duplicated if a future turn-by-turn investigator
 * loop is added.
 */
export const EVIDENCE_INTERPRETATION_GUIDANCE = `
${AGENT_BEHAVIOR_RULES}

When interpreting evidence:
- Every evidence item you're given already comes from a real tool result you were shown — you may explain and connect it, but never add a number that wasn't given to you.
- Prefer "likely cause", "strong evidence for", "consistent with" over definitive causal claims.
- If multiple hypotheses had some supporting evidence, mention the strongest one as the likely root cause and note that the others were considered and ruled out — do not silently ignore them.
`.trim();
