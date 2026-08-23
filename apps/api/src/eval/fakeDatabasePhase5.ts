// A small, self-contained in-memory fake `Database` for the Phase 5
// evaluation harness — deliberately separate from Phase 4's
// fakeDatabase.ts (which extends packages/agent's payment/refund fake for
// *aggregation* math). Phase 5's scenarios are about the
// recommendation/approval/execution *state machine*, idempotency, and
// merchant isolation — not statistical detection — so this fake only needs
// simple keyed lookups/updates over `payment` (read-only, pre-seeded),
// `recommendation`, `action`, and `auditEvent`. No real customer data;
// every row is synthetic and supplied by the calling scenario.

export interface FakePaymentRow {
  id: string;
  merchantId: string;
  razorpayPaymentId: string;
  amount: number;
  amountRefunded: number;
  currency: string;
  captured: boolean;
  /** Optional — only Track 03's recovery-batch scenarios need these for
   * listCapturedPaymentsInWindow's method/status/time-window filtering. */
  method?: string;
  status?: string;
  razorpayCreatedAt?: Date;
}

interface WhereClause {
  id?: string;
  merchantId?: string;
  recommendationId?: string;
  status?: string | { in: string[] };
  targetPaymentId?: string | { in: string[] };
  method?: string;
  razorpayCreatedAt?: { gte?: Date; lte?: Date };
  expiresAt?: unknown;
  OR?: unknown;
}

function matchesStatus(status: string, clause: WhereClause["status"]): boolean {
  if (clause === undefined) return true;
  if (typeof clause === "string") return status === clause;
  return clause.in.includes(status);
}

function matchesTargetPaymentId(
  targetPaymentId: string | null | undefined,
  clause: WhereClause["targetPaymentId"],
): boolean {
  if (clause === undefined) return true;
  if (typeof clause === "string") return targetPaymentId === clause;
  return (
    targetPaymentId !== null && targetPaymentId !== undefined && clause.in.includes(targetPaymentId)
  );
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function matchesWhere(row: Record<string, any>, where: WhereClause): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.merchantId !== undefined && row.merchantId !== where.merchantId) return false;
  if (where.recommendationId !== undefined && row.recommendationId !== where.recommendationId) {
    return false;
  }
  if (!matchesStatus(row.status, where.status)) return false;
  if (!matchesTargetPaymentId(row.targetPaymentId, where.targetPaymentId)) return false;
  if (where.method !== undefined && row.method !== where.method) return false;
  if (where.razorpayCreatedAt !== undefined) {
    const createdAt = row.razorpayCreatedAt as Date;
    if (
      where.razorpayCreatedAt.gte &&
      createdAt.getTime() < where.razorpayCreatedAt.gte.getTime()
    ) {
      return false;
    }
    if (
      where.razorpayCreatedAt.lte &&
      createdAt.getTime() > where.razorpayCreatedAt.lte.getTime()
    ) {
      return false;
    }
  }
  // `expiresAt`/`OR` (the approval expiry condition) are evaluated by the
  // caller via a pre-filtered `updateMany` — see note below; this fake
  // treats an explicit OR-on-expiresAt clause as "not expired" by checking
  // the row's own expiresAt directly, matching Postgres semantics closely
  // enough for these scenarios (expiresAt null or in the future).
  if (where.OR !== undefined) {
    const expiresAt = row.expiresAt as Date | null;
    const notExpired = expiresAt === null || expiresAt.getTime() > Date.now();
    if (!notExpired) return false;
  }
  return true;
}

/** Builds the fake Database. `clock` controls `createdAt`/`updatedAt` so a
 * scenario can simulate distinct points in time deterministically. */
export function createPhase5FakeDatabase(
  payments: FakePaymentRow[],
  clock: () => Date = () => new Date(),
) {
  const paymentsById = new Map(payments.map((p) => [p.id, p]));
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const recommendations: Record<string, any>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const actions: Record<string, any>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const auditEvents: Record<string, any>[] = [];
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const issues: Record<string, any>[] = [];
  let recCounter = 0;
  let actionCounter = 0;
  let auditCounter = 0;

  return {
    payment: {
      findUnique: ({ where }: { where: { id: string } }) =>
        Promise.resolve(paymentsById.get(where.id) ?? null),
      findFirst: ({ where }: { where: { id?: string; merchantId?: string } }) => {
        const row = where.id !== undefined ? paymentsById.get(where.id) : undefined;
        if (!row) return Promise.resolve(null);
        if (where.merchantId !== undefined && row.merchantId !== where.merchantId) {
          return Promise.resolve(null);
        }
        return Promise.resolve(row);
      },
      // Track 03: backs listCapturedPaymentsInWindow. Deterministic
      // ascending order (oldest first, tie-broken by id) — same contract
      // the real Prisma query guarantees.
      findMany: ({ where }: { where: WhereClause }) => {
        let rows = payments.filter((row) => matchesWhere(row, where));
        rows = [...rows].sort((a, b) => {
          const aTime = (a.razorpayCreatedAt as Date | undefined)?.getTime() ?? 0;
          const bTime = (b.razorpayCreatedAt as Date | undefined)?.getTime() ?? 0;
          return aTime !== bTime ? aTime - bTime : a.id.localeCompare(b.id);
        });
        return Promise.resolve(rows);
      },
    },
    recommendation: {
      findFirst: ({ where }: { where: WhereClause }) =>
        Promise.resolve(recommendations.find((row) => matchesWhere(row, where)) ?? null),
      findMany: ({ where, take }: { where?: WhereClause; take?: number }) => {
        let rows = recommendations.filter((row) => matchesWhere(row, where ?? {}));
        rows = [...rows].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
        if (take !== undefined) rows = rows.slice(0, take);
        return Promise.resolve(rows);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: ({ data }: { data: Record<string, any> }) => {
        recCounter += 1;
        const now = clock();
        const row = {
          issueId: null,
          investigationId: null,
          targetPaymentId: null,
          amountMinorUnits: null,
          currency: null,
          approvedAt: null,
          rejectedAt: null,
          expiresAt: null,
          ...data,
          id: `fake-rec-${recCounter}`,
          createdAt: now,
          updatedAt: now,
        };
        recommendations.push(row);
        return Promise.resolve(row);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = recommendations.find((r) => r.id === where.id);
        if (!row) throw new Error(`fake recommendation "${where.id}" not found`);
        Object.assign(row, data, { updatedAt: clock() });
        return Promise.resolve(row);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: ({ where, data }: { where: WhereClause; data: Record<string, any> }) => {
        let count = 0;
        for (const row of recommendations) {
          if (!matchesWhere(row, where)) continue;
          Object.assign(row, data, { updatedAt: clock() });
          count += 1;
        }
        return Promise.resolve({ count });
      },
    },
    action: {
      findFirst: ({ where }: { where: WhereClause }) =>
        Promise.resolve(actions.find((row) => matchesWhere(row, where)) ?? null),
      findUnique: ({ where }: { where: { id?: string; recommendationId?: string } }) =>
        Promise.resolve(
          actions.find((row) =>
            where.id !== undefined
              ? row.id === where.id
              : row.recommendationId === where.recommendationId,
          ) ?? null,
        ),
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: ({ data }: { data: Record<string, any> }) => {
        actionCounter += 1;
        const now = clock();
        const row = {
          paymentId: null,
          amountMinorUnits: null,
          currency: null,
          providerReference: null,
          providerStatus: null,
          errorCode: null,
          errorMessage: null,
          approvedAt: null,
          startedAt: null,
          completedAt: null,
          ...data,
          id: `fake-action-${actionCounter}`,
          createdAt: now,
          updatedAt: now,
        };
        actions.push(row);
        return Promise.resolve(row);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      update: ({ where, data }: { where: { id: string }; data: Record<string, any> }) => {
        const row = actions.find((r) => r.id === where.id);
        if (!row) throw new Error(`fake action "${where.id}" not found`);
        Object.assign(row, data, { updatedAt: clock() });
        return Promise.resolve(row);
      },
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      updateMany: ({ where, data }: { where: WhereClause; data: Record<string, any> }) => {
        let count = 0;
        for (const row of actions) {
          if (!matchesWhere(row, where)) continue;
          Object.assign(row, data, { updatedAt: clock() });
          count += 1;
        }
        return Promise.resolve({ count });
      },
    },
    auditEvent: {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      create: ({ data }: { data: Record<string, any> }) => {
        auditCounter += 1;
        const row = { ...data, id: `fake-audit-${auditCounter}`, createdAt: clock() };
        auditEvents.push(row);
        return Promise.resolve(row);
      },
      findMany: () => Promise.resolve([...auditEvents]),
    },
    // Minimal, read-only — just enough for the cross-merchant isolation
    // scenario (Phase 6 brief section 5, scenario L) to verify an Issue
    // seeded for one merchant is never returned for another.
    issue: {
      findFirst: ({ where }: { where: WhereClause }) =>
        Promise.resolve(issues.find((row) => matchesWhere(row, where)) ?? null),
    },
    // Test-only accessors — never part of the real Database shape.
    __auditEvents: auditEvents,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    __seedIssue: (row: Record<string, any>) => {
      issues.push({ id: `fake-issue-${issues.length + 1}`, ...row });
      return issues[issues.length - 1];
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
