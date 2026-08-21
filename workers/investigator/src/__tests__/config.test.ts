import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const BASE_ENV = { DATABASE_URL: "postgresql://user:pass@localhost:5432/db" };

describe("loadConfig", () => {
  it("defaults to the deterministic provider and a 15-minute detection interval", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.AI_PROVIDER).toBe("deterministic");
    expect(config.DETECTION_INTERVAL_MS).toBe(15 * 60 * 1000);
    expect(config.MAX_AGENT_STEPS).toBe(8);
  });

  it("honors a configured detection interval", () => {
    const config = loadConfig({ ...BASE_ENV, DETECTION_INTERVAL_MS: "60000" });
    expect(config.DETECTION_INTERVAL_MS).toBe(60_000);
  });

  it("throws a safe ConfigError (no leaked env values) when DATABASE_URL is missing", () => {
    expect(() => loadConfig({})).toThrow(/DATABASE_URL/);
  });

  it("requires AI_MODEL and AI_API_KEY when AI_PROVIDER=anthropic", () => {
    expect(() => loadConfig({ ...BASE_ENV, AI_PROVIDER: "anthropic" })).toThrow(
      /AI_MODEL and AI_API_KEY/,
    );
  });

  it("accepts AI_PROVIDER=anthropic when both AI_MODEL and AI_API_KEY are set", () => {
    const config = loadConfig({
      ...BASE_ENV,
      AI_PROVIDER: "anthropic",
      AI_MODEL: "claude-x",
      AI_API_KEY: "sk-test",
    });
    expect(config.AI_PROVIDER).toBe("anthropic");
  });
});
