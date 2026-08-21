import { ConfigError } from "@paysherlock/types";
import { AnthropicProvider } from "./anthropicProvider.js";
import { DeterministicProvider } from "./deterministicProvider.js";
import type { LLMProvider } from "./types.js";

export interface ProviderFactoryConfig {
  aiProvider: "anthropic" | "deterministic";
  aiModel?: string | undefined;
  aiApiKey?: string | undefined;
}

/** Selects the LLM provider from configuration — never hard-coded. Callers
 * (apps/api's entrypoint) build this config from env vars; tests and the
 * evaluation harness construct DeterministicProvider directly instead of
 * going through this, so they never depend on env/network regardless of
 * what's configured in the environment. */
export function createProvider(config: ProviderFactoryConfig): LLMProvider {
  switch (config.aiProvider) {
    case "anthropic":
      if (!config.aiApiKey || !config.aiModel) {
        throw new ConfigError("AI_PROVIDER=anthropic requires AI_MODEL and AI_API_KEY to be set");
      }
      return new AnthropicProvider({ apiKey: config.aiApiKey, model: config.aiModel });
    case "deterministic":
      return new DeterministicProvider();
  }
}
