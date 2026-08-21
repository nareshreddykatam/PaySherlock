import { ToolRegistry } from "./registry.js";
import { getPaymentsTool } from "./definitions/getPayments.js";
import { getPaymentFailuresTool } from "./definitions/getPaymentFailures.js";
import { comparePeriodsTool } from "./definitions/comparePeriods.js";
import { segmentPaymentsTool } from "./definitions/segmentPayments.js";
import { analyzeFailureCodesTool } from "./definitions/analyzeFailureCodes.js";
import { getRefundsTool } from "./definitions/getRefunds.js";
import { calculateRevenueImpactTool } from "./definitions/calculateRevenueImpact.js";

/** Builds the full Phase 2 investigation tool registry. A fresh registry
 * per call (cheap, stateless) avoids any shared mutable state between
 * callers. */
export function createToolRegistry(): ToolRegistry {
  const registry = new ToolRegistry();
  registry.register(getPaymentsTool);
  registry.register(getPaymentFailuresTool);
  registry.register(comparePeriodsTool);
  registry.register(segmentPaymentsTool);
  registry.register(analyzeFailureCodesTool);
  registry.register(getRefundsTool);
  registry.register(calculateRevenueImpactTool);
  return registry;
}
