import { describe, expect, it } from "vitest";
import { loadConfig } from "../config.js";

const BASE_ENV = {
  DATABASE_URL: "postgresql://localhost:5432/test",
  RAZORPAY_KEY_ID: "rzp_test_id",
  RAZORPAY_KEY_SECRET: "rzp_test_secret",
  RAZORPAY_WEBHOOK_SECRET: "whsec_test",
};

describe("loadConfig — DEMO_MODE (Phase 7)", () => {
  it("defaults DEMO_MODE to false when unset", () => {
    const config = loadConfig(BASE_ENV);
    expect(config.DEMO_MODE).toBe(false);
  });

  it("parses DEMO_MODE=true in development", () => {
    const config = loadConfig({ ...BASE_ENV, NODE_ENV: "development", DEMO_MODE: "true" });
    expect(config.DEMO_MODE).toBe(true);
  });

  it("parses the literal string 'false' as false — never coerced to true", () => {
    const config = loadConfig({ ...BASE_ENV, DEMO_MODE: "false" });
    expect(config.DEMO_MODE).toBe(false);
  });

  it("refuses to load when DEMO_MODE=true and NODE_ENV=production — fail closed", () => {
    expect(() => loadConfig({ ...BASE_ENV, NODE_ENV: "production", DEMO_MODE: "true" })).toThrow(
      /DEMO_MODE/,
    );
  });

  it("allows DEMO_MODE=false with NODE_ENV=production", () => {
    const config = loadConfig({ ...BASE_ENV, NODE_ENV: "production", DEMO_MODE: "false" });
    expect(config.DEMO_MODE).toBe(false);
    expect(config.NODE_ENV).toBe("production");
  });

  it("rejects a non-boolean-shaped DEMO_MODE value rather than guessing", () => {
    expect(() => loadConfig({ ...BASE_ENV, DEMO_MODE: "yes" })).toThrow();
  });
});
