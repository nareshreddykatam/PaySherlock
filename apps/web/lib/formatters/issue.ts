import type { AnomalyType, DetectionSeverity, IssueStatus } from "@paysherlock/types";
import type { BadgeTone } from "@/components/ui/Badge";

export const ANOMALY_TYPE_LABELS: Record<AnomalyType, string> = {
  PAYMENT_FAILURE_SPIKE: "Payment failure spike",
  PAYMENT_METHOD_DEGRADATION: "Payment method degradation",
  REFUND_SPIKE: "Refund spike",
  TRANSACTION_VOLUME_DECLINE: "Transaction volume decline",
  HIGH_VALUE_TRANSACTION_DECLINE: "High-value transaction decline",
};

export const SEVERITY_TONE: Record<DetectionSeverity, BadgeTone> = {
  CRITICAL: "red",
  WARNING: "amber",
  INFO: "neutral",
};

export const STATUS_LABELS: Record<IssueStatus, string> = {
  DETECTED: "Detected",
  INVESTIGATING: "Investigating",
  IDENTIFIED: "Identified",
  MONITORING: "Monitoring",
  RESOLVED: "Resolved",
  DISMISSED: "Dismissed",
  INVESTIGATION_FAILED: "Investigation failed",
};

export const STATUS_TONE: Record<IssueStatus, BadgeTone> = {
  DETECTED: "neutral",
  INVESTIGATING: "amber",
  IDENTIFIED: "emerald",
  MONITORING: "neutral",
  RESOLVED: "emerald",
  DISMISSED: "neutral",
  INVESTIGATION_FAILED: "red",
};
