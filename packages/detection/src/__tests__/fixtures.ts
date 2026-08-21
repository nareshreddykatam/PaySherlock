// A tiny in-memory stand-in for the Prisma `Database` client, in the same
// spirit as packages/agent/src/eval/fakeDatabase.ts — implements only the
// exact call shapes packages/database's analytics functions use, driven by
// plain synthetic rows, so detector tests exercise real aggregation logic
// instead of hand-mocked per-call responses. No real customer data — every
// row is synthetic. Kept local to this package rather than importing
// packages/agent's copy, since that one isn't part of @paysherlock/agent's
// public API (it's eval-internal).

export interface FakePayment {
  merchantId: string;
  razorpayCreatedAt: Date;
  status: "CREATED" | "AUTHORIZED" | "CAPTURED" | "REFUNDED" | "FAILED";
  method: "CARD" | "NETBANKING" | "WALLET" | "UPI" | "EMI" | "OTHER";
  amount: number;
}

export interface FakeRefund {
  merchantId: string;
  razorpayCreatedAt: Date;
  status: "PENDING" | "PROCESSED" | "FAILED";
  amount: number;
}

interface WhereClause {
  merchantId?: string;
  status?: string;
  razorpayCreatedAt?: { gte?: Date; lt?: Date };
}

function matches<T extends { merchantId: string; status: string; razorpayCreatedAt: Date }>(
  row: T,
  where: WhereClause,
): boolean {
  if (where.merchantId && row.merchantId !== where.merchantId) return false;
  if (where.status && row.status !== where.status) return false;
  if (where.razorpayCreatedAt) {
    const { gte, lt } = where.razorpayCreatedAt;
    if (gte && row.razorpayCreatedAt < gte) return false;
    if (lt && row.razorpayCreatedAt >= lt) return false;
  }
  return true;
}

export function createFakeDatabase(payments: FakePayment[], refunds: FakeRefund[]) {
  return {
    payment: {
      aggregate: ({ where }: { where: WhereClause }) => {
        const rows = payments.filter((p) => matches(p, where));
        return Promise.resolve({
          _count: rows.length,
          _sum: { amount: rows.reduce((sum, r) => sum + r.amount, 0) },
        });
      },
      groupBy: ({ by, where }: { by: string[]; where: WhereClause }) => {
        const rows = payments.filter((p) => matches(p, where));
        const groups = new Map<
          string,
          { keyValues: Record<string, unknown>; count: number; amount: number }
        >();
        for (const row of rows) {
          const keyValues = Object.fromEntries(
            by.map((key) => [key, (row as unknown as Record<string, unknown>)[key]]),
          );
          const groupKey = JSON.stringify(keyValues);
          const group = groups.get(groupKey) ?? { keyValues, count: 0, amount: 0 };
          group.count += 1;
          group.amount += row.amount;
          groups.set(groupKey, group);
        }
        return Promise.resolve(
          [...groups.values()].map((group) => ({
            ...group.keyValues,
            _count: group.count,
            _sum: { amount: group.amount },
          })),
        );
      },
      findMany: ({
        where,
        select,
        take,
      }: {
        where: WhereClause;
        select: Record<string, boolean>;
        take?: number;
      }) => {
        const rows = payments.filter((p) => matches(p, where)).slice(0, take ?? payments.length);
        const fields = Object.keys(select);
        return Promise.resolve(
          rows.map((row) => {
            const projected: Record<string, unknown> = {};
            for (const field of fields)
              projected[field] = (row as unknown as Record<string, unknown>)[field];
            return projected;
          }),
        );
      },
    },
    refund: {
      aggregate: ({ where }: { where: WhereClause }) => {
        const rows = refunds.filter((r) => matches(r, where));
        return Promise.resolve({
          _count: rows.length,
          _sum: { amount: rows.reduce((sum, r) => sum + r.amount, 0) },
        });
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

/** Evenly spreads `count` identical synthetic payments across a window —
 * no randomness, so test expectations are exact and reproducible. */
export function makePayments(params: {
  merchantId: string;
  start: Date;
  end: Date;
  count: number;
  status: FakePayment["status"];
  method: FakePayment["method"];
  amount: number;
}): FakePayment[] {
  if (params.count <= 0) return [];
  const span = params.end.getTime() - params.start.getTime();
  return Array.from({ length: params.count }, (_, i) => ({
    merchantId: params.merchantId,
    razorpayCreatedAt: new Date(params.start.getTime() + Math.floor((i / params.count) * span)),
    status: params.status,
    method: params.method,
    amount: params.amount,
  }));
}

export function makeRefunds(params: {
  merchantId: string;
  start: Date;
  end: Date;
  count: number;
  amount: number;
}): FakeRefund[] {
  if (params.count <= 0) return [];
  const span = params.end.getTime() - params.start.getTime();
  return Array.from({ length: params.count }, (_, i) => ({
    merchantId: params.merchantId,
    razorpayCreatedAt: new Date(params.start.getTime() + Math.floor((i / params.count) * span)),
    status: "PROCESSED" as const,
    amount: params.amount,
  }));
}
