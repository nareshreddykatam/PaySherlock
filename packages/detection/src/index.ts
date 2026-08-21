// @paysherlock/detection — the deterministic anomaly detection engine.
// "Is something anomalous?" is decided entirely here, in code; "why is it
// probably happening?" is the existing Phase 2 investigation engine's job,
// not this package's. See docs/decisions and docs/architecture.

export * from "./baseline/window.js";
export * from "./baseline/compare.js";
export * from "./severity/severity.js";
export * from "./fingerprint/fingerprint.js";
export * from "./engine/types.js";
export * from "./engine/defaults.js";
export * from "./engine/registry.js";
export * from "./engine/detectionRun.js";

export * from "./detectors/failureSpike.js";
export * from "./detectors/methodDegradation.js";
export * from "./detectors/refundSpike.js";
export * from "./detectors/volumeDecline.js";
export * from "./detectors/highValueDecline.js";
