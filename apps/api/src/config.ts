import { z } from "zod";
import { ConfigError } from "@paysherlock/types";

const EnvSchema = z
  .object({
    DATABASE_URL: z.string().min(1, "DATABASE_URL is required"),
    RAZORPAY_KEY_ID: z.string().min(1, "RAZORPAY_KEY_ID is required"),
    RAZORPAY_KEY_SECRET: z.string().min(1, "RAZORPAY_KEY_SECRET is required"),
    RAZORPAY_WEBHOOK_SECRET: z.string().min(1, "RAZORPAY_WEBHOOK_SECRET is required"),
    PORT: z.coerce.number().int().positive().default(4000),
    NODE_ENV: z.enum(["development", "test", "production"]).default("development"),
    // AI investigation engine — provider-independent. Defaults to the
    // zero-dependency deterministic provider so the API runs out of the box
    // without any AI credentials; set AI_PROVIDER=anthropic + AI_MODEL +
    // AI_API_KEY to use a real model instead.
    AI_PROVIDER: z.enum(["anthropic", "deterministic"]).default("deterministic"),
    AI_MODEL: z.string().optional(),
    AI_API_KEY: z.string().optional(),
    MAX_AGENT_STEPS: z.coerce.number().int().positive().default(8),
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

export type AppConfig = z.infer<typeof EnvSchema>;

/**
 * Validates and loads server configuration from environment variables.
 * Only called from the process entrypoint (index.ts) and CLI scripts —
 * never from server.ts or tests, so route/handler tests don't need real
 * env vars (they inject mock dependencies instead).
 */
export function loadConfig(env: NodeJS.ProcessEnv = process.env): AppConfig {
  const parsed = EnvSchema.safeParse(env);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`);
    throw new ConfigError(`Invalid environment configuration — ${issues.join("; ")}`);
  }
  return parsed.data;
}
