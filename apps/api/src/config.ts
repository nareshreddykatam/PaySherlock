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
    // Browser origin allowed to call this API — apps/web's dev/deployed URL.
    CORS_ORIGIN: z.string().min(1).default("http://localhost:3000"),
    // Phase 7: server-side-only switch that makes every route resolve the
    // dedicated "PaySherlock Demo Merchant" instead of the default merchant
    // — never a client-supplied value, never available in production (see
    // the refinement below). Off by default. Deliberately NOT
    // `z.coerce.boolean()`: that coerces the *string* "false" to `true`
    // (any non-empty string is truthy), which would silently invert an
    // explicit DEMO_MODE=false in .env.
    DEMO_MODE: z
      .enum(["true", "false"])
      .default("false")
      .transform((v) => v === "true"),
  })
  .superRefine((env, ctx) => {
    if (env.AI_PROVIDER === "anthropic" && (!env.AI_MODEL || !env.AI_API_KEY)) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["AI_PROVIDER"],
        message: "AI_PROVIDER=anthropic requires AI_MODEL and AI_API_KEY to also be set",
      });
    }
    if (env.DEMO_MODE && env.NODE_ENV === "production") {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ["DEMO_MODE"],
        message: "DEMO_MODE must never be enabled when NODE_ENV=production",
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
