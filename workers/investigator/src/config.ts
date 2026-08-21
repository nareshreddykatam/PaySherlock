import { z } from "zod";
import { ConfigError } from "@paysherlock/types";

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    // Same provider-independent AI layer apps/api uses — defaults to the
    // zero-dependency deterministic provider so the worker runs out of the
    // box with no AI credentials. See apps/api/src/config.ts.
    AI_PROVIDER: z.enum(["anthropic", "deterministic"]).default("deterministic"),
    AI_MODEL: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    MAX_AGENT_STEPS: z.coerce.number().int().positive().default(8),
    // Phase 4 brief section 26 — configurable, defaults to 15 minutes.
    DETECTION_INTERVAL_MS: z.coerce
      .number()
      .int()
      .positive()
      .default(15 * 60 * 1000),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "anthropic" && (!env.AI_MODEL || !env.AI_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AI_PROVIDER"],
        message: "AI_PROVIDER=anthropic requires AI_MODEL and AI_API_KEY to also be set",
      });
    }
  });

export type WorkerConfig = z.infer<typeof EnvSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): WorkerConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`Invalid environment configuration — ${issues.join("; ")}`);
  }
  return parsed.data;
}
