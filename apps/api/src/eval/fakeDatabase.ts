import {
  createFakeDatabase as createAgentFakeDatabase,
  type FakePayment,
  type FakeRefund,
} from "@paysherlock/agent";

// Extends packages/agent's exported synthetic payment/refund fake database
// (see its docs/decisions rationale — same reasoning applies here) with an
// in-memory `issue` table implementing exactly the Prisma call shapes
// packages/database's issue upsert/query functions use. Built for the
// Phase 4 end-to-end evaluation harness below, where detection, issue
// persistence, and the real investigation engine all run together against
// synthetic data — no real customer data, no live Postgres required.

interface WhereClause {
  id?: string;
  merchantId?: string;
  fingerprint?: string;
  status?: string | { in: string[] };
  updatedAt?: { lt?: Date };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export interface FakeIssueRow extends Record<string, any> {
  id: string;
  merchantId: string;
  status: string;
  fingerprint: string;
  occurrenceCount: number;
  detectedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

function matchesStatus(status: string, clause: WhereClause["status"]): boolean {
  if (clause === undefined) return true;
  if (typeof clause === "string") return status === clause;
  return clause.in.includes(status);
}

function matchesWhere(row: FakeIssueRow, where: WhereClause): boolean {
  if (where.id !== undefined && row.id !== where.id) return false;
  if (where.merchantId !== undefined && row.merchantId !== where.merchantId) return false;
  if (where.fingerprint !== undefined && row.fingerprint !== where.fingerprint) return false;
  if (!matchesStatus(row.status, where.status)) return false;
  if (where.updatedAt?.lt !== undefined && !(row.updatedAt < where.updatedAt.lt)) return false;
  return true;
}

/**
 * Builds a fake `Database` with `payment`/`refund` (from
 * @paysherlock/agent) plus `issue`. `clock` controls the timestamp used for
 * `createdAt`/`updatedAt` — deliberately NOT the real wall clock, so an
 * eval scenario can simulate multiple detection runs at precise, synthetic
 * points in time (needed for the persistence/staleness scenarios) without
 * depending on how fast the test actually executes.
 */
export function createPhase4FakeDatabase(
  payments: FakePayment[],
  refunds: FakeRefund[],
  clock: () => Date,
) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const db = createAgentFakeDatabase(payments, refunds) as any;
  const issues: FakeIssueRow[] = [];
  let idCounter = 0;

  db.issue = {
    findFirst: ({ where }: { where: WhereClause }) => {
      return Promise.resolve(issues.find((row) => matchesWhere(row, where)) ?? null);
    },
    findUnique: ({ where }: { where: { id: string } }) => {
      return Promise.resolve(issues.find((row) => row.id === where.id) ?? null);
    },
    findMany: ({ where, take }: { where?: WhereClause; take?: number }) => {
      let rows = issues.filter((row) => matchesWhere(row, where ?? {}));
      rows = [...rows].sort((a, b) => b.detectedAt.getTime() - a.detectedAt.getTime());
      if (take !== undefined) rows = rows.slice(0, take);
      return Promise.resolve(rows);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    create: ({ data }: { data: Record<string, any> }) => {
      idCounter += 1;
      const now = clock();
      const row = {
        occurrenceCount: 1,
        investigationId: null,
        rootCause: null,
        confidence: null,
        estimatedImpactMinorUnits: null,
        investigationResult: null,
        investigationError: null,
        ...data,
        id: `fake-issue-${idCounter}`,
        createdAt: now,
        updatedAt: now,
      } as unknown as FakeIssueRow;
      issues.push(row);
      return Promise.resolve(row);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    update: ({ where, data }: { where: WhereClause; data: Record<string, any> }) => {
      const row = issues.find((r) => r.id === where.id);
      if (!row) throw new Error(`fake issue "${where.id}" not found`);
      Object.assign(row, data, { updatedAt: clock() });
      return Promise.resolve(row);
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    updateMany: ({ where, data }: { where: WhereClause; data: Record<string, any> }) => {
      let count = 0;
      for (const row of issues) {
        if (!matchesWhere(row, where)) continue;
        Object.assign(row, data, { updatedAt: clock() });
        count += 1;
      }
      return Promise.resolve({ count });
    },
  };

  return db;
}

export type { FakePayment, FakeRefund };
