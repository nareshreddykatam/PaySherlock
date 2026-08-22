// @paysherlock/actions — the guarded recommendation/approval/execution
// layer. Hard rule: the LLM never executes a financial action. Everything
// here is deterministic: risk policy, eligibility validation, and the one
// real action executor (refund). No dependency on @paysherlock/agent
// anywhere in this package — see docs/decisions.

export * from "./policy/riskPolicy.js";
export * from "./validation/refundEligibility.js";
export * from "./validation/recommendationValidation.js";
export * from "./registry/actionTypes.js";
export * from "./refund/executeRefund.js";
export * from "./recommend/generateRecommendation.js";
