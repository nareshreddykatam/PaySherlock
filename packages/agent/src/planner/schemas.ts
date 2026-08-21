import { z } from "zod";

/** Validates a provider's raw plan response before we trust it at all —
 * defense against a malformed/partial model response, independent of the
 * further tool/hypothesis-catalog filtering `createInvestigationPlan` does. */
export const RawPlanSchema = z.object({
  objective: z.string().min(1),
  steps: z.array(
    z.object({
      tool: z.string().min(1),
      input: z.record(z.string(), z.unknown()).default({}),
      rationale: z.string().optional(),
    }),
  ),
  candidateHypothesisIds: z.array(z.string()),
});
