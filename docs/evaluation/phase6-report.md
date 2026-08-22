# Phase 6 — End-to-End Evaluation Report

> **Synthetic evaluation.** Every scenario below runs against synthetic, non-real data and a mocked Razorpay client — never live credentials, never a live database. These results describe this harness's controlled scenarios, not real-world production accuracy.

- **Generated:** 2026-08-22T14:35:18.713Z
- **Git commit:** `772ec131491408ecbc0ff388e85feba4ba1762e0`
- **Node:** v24.18.1
- **Environment:** AI provider = deterministic, Razorpay = mocked, database = in-memory fake (no live Postgres)

## Scenario results

| ID  | Scenario                       | Category  | Result  |
| --- | ------------------------------ | --------- | ------- |
| A   | Healthy merchant               | detection | ✅ PASS |
| B   | UPI degradation                | detection | ✅ PASS |
| C   | Payment failure spike          | detection | ✅ PASS |
| D   | Refund spike                   | detection | ✅ PASS |
| E   | Transaction volume decline     | detection | ✅ PASS |
| F   | High-value transaction decline | detection | ✅ PASS |
| G   | Valid guarded refund           | action    | ✅ PASS |
| H   | Double approval                | action    | ✅ PASS |
| I   | Stale refund state             | action    | ✅ PASS |
| J   | Provider failure               | action    | ✅ PASS |
| K   | Retry after provider failure   | action    | ✅ PASS |
| L   | Cross-merchant isolation       | security  | ✅ PASS |

### A — Healthy merchant

**Result:** PASS

### B — UPI degradation

**Result:** PASS

- business impact computed for 2/2 issue(s)
- no financial action occurred automatically (Phase 6 hard requirement)

### C — Payment failure spike

**Result:** PASS

- business impact computed for 0/4 issue(s)
- no financial action occurred automatically (Phase 6 hard requirement)

### D — Refund spike

**Result:** PASS

- business impact computed for 1/1 issue(s)
- no financial action occurred automatically (Phase 6 hard requirement)

### E — Transaction volume decline

**Result:** PASS

- business impact computed for 0/2 issue(s)
- no financial action occurred automatically (Phase 6 hard requirement)

### F — High-value transaction decline

**Result:** PASS

- business impact computed for 1/2 issue(s)
- no financial action occurred automatically (Phase 6 hard requirement)

### G — Valid guarded refund

**Result:** PASS

- exactly one refund action executed

### H — Double approval

**Result:** PASS

- 1 of 2 concurrent approvals succeeded
- 1 provider call(s) made

### I — Stale refund state

**Result:** PASS

- execution blocked before any provider call — live state re-validated

### J — Provider failure

**Result:** PASS

- action FAILED, audit event recorded, error message contained no stack trace

### K — Retry after provider failure

**Result:** PASS

- retry reused the same idempotency key and reached SUCCEEDED

### L — Cross-merchant isolation

**Result:** PASS

- recommendation blocked for other merchant: true
- action blocked for other merchant: true
- issue blocked for other merchant: true

## Metrics

### Detection

- Recall: 1.00
- False-positive rate: 0.00
- Duplicate issue rate: unavailable

### Investigation

- Trigger success rate: 1.00
- Root-cause accuracy: 0.60
- Evidence accuracy: unavailable

### Actions

- Approval success rate: 1.00
- Duplicate execution rate: 0.00
- Stale-state rejection rate: 1.00
- Action success rate: 1.00
- False-success rate: 0.00

### Reliability

- Unhandled exceptions: 0
- Failed requests: unavailable
- Retry correctness: pass

### Security

- Cross-merchant access failures blocked: 3
- Approval bypass attempts blocked: 1

## Limitations

- All data is synthetic; no live Postgres or live Razorpay Test Mode was used.
- Detection precision/recall are computed over this harness's own small scenario set, not real merchant traffic — not a production accuracy claim.
- evidenceAccuracy and failedRequests are not measured by this harness (no independent ground truth / no real HTTP layer involved) and are reported as unavailable rather than fabricated.
- duplicateIssueRate is exercised by the separate Phase 4 evaluation harness (multi-run scenarios), not re-measured here to avoid duplicating that harness's logic.
