// A tiny in-memory stand-in for the Prisma `Database` client, driven by
// plain synthetic rows instead of hand-crafted per-call mock responses.
// Building this once here — rather than hand-mocking every groupBy/
// aggregate call for every scenario — is what makes the 5 evaluation
// scenarios (and the full-pipeline agent tests) tractable to write and
// maintain: each scenario is just a list of synthetic payment/refund rows,
// and this engine computes the same aggregates Postgres would. No real
// customer data — every row is synthetic. See docs/decisions.

export interface FakePayment {
  merchantId: string;
  razorpayCreatedAt: Date;
  status: "CREATED" | "AUTHORIZED" | "CAPTURED" | "REFUNDED" | "FAILED";
  method: "CARD" | "NETBANKING" | "WALLET" | "UPI" | "EMI" | "OTHER";
  amount: number;
  errorCode?: string | null;
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

function matchesWhere<T extends { merchantId: string; status: string; razorpayCreatedAt: Date }>(
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

/** Builds a fake `Database`-shaped object backed by in-memory rows. Only
 * implements the exact call shapes packages/database's analytics functions
 * use (aggregate/groupBy/findMany with where/by/select/take) — not a
 * general Prisma mock. */
export function createFakeDatabase(payments: FakePayment[], refunds: FakeRefund[]) {
  return {
    payment: {
      aggregate: ({ where }: { where: WhereClause }) => {
        const rows = payments.filter((p) => matchesWhere(p, where));
        return Promise.resolve({
          _count: rows.length,
          _sum: { amount: rows.reduce((sum, r) => sum + r.amount, 0) },
        });
      },
      groupBy: ({ by, where }: { by: string[]; where: WhereClause }) => {
        const rows = payments.filter((p) => matchesWhere(p, where));
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
        const rows = payments
          .filter((p) => matchesWhere(p, where))
          .slice(0, take ?? payments.length);
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
        const rows = refunds.filter((r) => matchesWhere(r, where));
        return Promise.resolve({
          _count: rows.length,
          _sum: { amount: rows.reduce((sum, r) => sum + r.amount, 0) },
        });
      },
    },
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}
