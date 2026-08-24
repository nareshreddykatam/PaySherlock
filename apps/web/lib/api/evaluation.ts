import { z } from "zod";
import { apiFetch } from "./client";

// Track 03 (AI Revenue Recovery) — no packages/types schema of its own,
// same frontend-local-schema pattern as issues.ts's RecoveryBatchSchema.
// This is the SAME offline harness `pnpm eval:track03` runs, exposed
// read-only over HTTP (apps/api/src/routes/evaluation.ts) so the UI never
// duplicates these numbers as hardcoded constants.
export const Track03EvaluationSchema = z.object({
  generatedAt: z.string(),
  environment: z.object({
    mode: z.literal("synthetic"),
    provider: z.string(),
    disclosure: z.string(),
  }),
  metrics: z.object({
    batchSize: z.number(),
    candidatesFound: z.number(),
    candidatesEligible: z.number(),
    candidatesRejected: z.number(),
    candidatesAttempted: z.number(),
    successfulRecoveries: z.number(),
    failedRecoveries: z.number(),
    amountEligibleMinorUnits: z.number(),
    amountAttemptedMinorUnits: z.number(),
    amountRecoveredMinorUnits: z.number(),
    recoveryRate: z.number(),
    duplicateExecutionCount: z.number(),
    falseSuccessCount: z.number(),
    stoppingReason: z.string().nullable(),
  }),
  scenariosPassed: z.number(),
  scenariosTotal: z.number(),
  limitations: z.array(z.string()),
});
export type Track03Evaluation = z.infer<typeof Track03EvaluationSchema>;

export async function getTrack03Evaluation(): Promise<Track03Evaluation> {
  const raw = await apiFetch<unknown>("/eval/track03");
  const parsed = Track03EvaluationSchema.safeParse(raw);
  if (!parsed.success) {
    throw new Error("The evaluation service returned an unexpected response shape.");
  }
  return parsed.data;
}
