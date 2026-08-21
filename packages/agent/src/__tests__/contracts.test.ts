import { describe, expect, it } from "vitest";
import {
  EvidenceSchema,
  HypothesisSchema,
  InvestigationRequestSchema,
  InvestigationResultSchema,
  ToolResultSchema,
} from "@paysherlock/types";

describe("InvestigationRequestSchema", () => {
  it("accepts a valid request", () => {
    const result = InvestigationRequestSchema.safeParse({
      question: "Why did revenue drop yesterday?",
      merchantId: "merchant-1",
    });
    expect(result.success).toBe(true);
  });

  it("rejects an empty question", () => {
    const result = InvestigationRequestSchema.safeParse({ question: "", merchantId: "merchant-1" });
    expect(result.success).toBe(false);
  });

  it("rejects a request missing merchantId (the trusted authorization field)", () => {
    const result = InvestigationRequestSchema.safeParse({ question: "Why did revenue drop?" });
    expect(result.success).toBe(false);
  });
});

describe("ToolResultSchema", () => {
  it("accepts a well-formed successful result", () => {
    const result = ToolResultSchema.safeParse({
      id: "call_1",
      tool: "get_payments",
      success: true,
      output: { totalCount: 10 },
      durationMs: 12,
    });
    expect(result.success).toBe(true);
  });

  it("rejects malformed agent output missing required fields", () => {
    const result = ToolResultSchema.safeParse({ tool: "get_payments" });
    expect(result.success).toBe(false);
  });
});

describe("HypothesisSchema", () => {
  it("rejects a status outside the fixed enum", () => {
    const result = HypothesisSchema.safeParse({
      id: "h1",
      statement: "test",
      status: "PROBABLY",
      evidenceIds: [],
    });
    expect(result.success).toBe(false);
  });

  it("rejects a confidence value outside [0, 1]", () => {
    const result = HypothesisSchema.safeParse({
      id: "h1",
      statement: "test",
      status: "SUPPORTED",
      evidenceIds: ["ev_1"],
      confidence: 1.5,
    });
    expect(result.success).toBe(false);
  });
});

describe("EvidenceSchema", () => {
  it("requires a source, so evidence can't exist without a traceable origin", () => {
    const result = EvidenceSchema.safeParse({
      id: "ev_1",
      metric: "failure_rate",
      observedValue: 0.2,
    });
    expect(result.success).toBe(false);
  });
});

describe("InvestigationResultSchema", () => {
  const validResult = {
    question: "Why did revenue drop?",
    summary: "No significant anomaly detected.",
    evidence: [],
    rejectedHypotheses: [],
    recommendations: ["Continue monitoring."],
    meta: { investigationId: "inv_1", stepsExecuted: 5, toolCalls: 5, provider: "deterministic" },
  };

  it("accepts a well-formed result", () => {
    expect(InvestigationResultSchema.safeParse(validResult).success).toBe(true);
  });

  it("rejects a result with a malformed confidence value", () => {
    const result = InvestigationResultSchema.safeParse({ ...validResult, confidence: "very high" });
    expect(result.success).toBe(false);
  });

  it("rejects a result missing observability metadata", () => {
    const { meta: _meta, ...withoutMeta } = validResult;
    const result = InvestigationResultSchema.safeParse(withoutMeta);
    expect(result.success).toBe(false);
  });
});
