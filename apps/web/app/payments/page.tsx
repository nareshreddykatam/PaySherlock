"use client";

import { useCallback, useState } from "react";
import { CreditCard } from "lucide-react";
import { getPayments, type Payment } from "@/lib/api/payments";
import { useApiQuery } from "@/lib/api/useApiQuery";
import { PaymentsTable } from "@/components/payments/PaymentsTable";
import { Skeleton } from "@/components/ui/Skeleton";
import { ErrorState } from "@/components/ui/ErrorState";
import { EmptyState } from "@/components/ui/EmptyState";
import { Button } from "@/components/ui/Button";

export default function PaymentsPage() {
  const [payments, setPayments] = useState<Payment[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);

  const { loading, error, reload } = useApiQuery(async () => {
    const page = await getPayments({ limit: 25 });
    setPayments(page.data);
    setNextCursor(page.nextCursor);
    return page;
  }, []);

  const loadMore = useCallback(async () => {
    if (!nextCursor) return;
    setLoadingMore(true);
    try {
      const page = await getPayments({ cursor: nextCursor, limit: 25 });
      setPayments((prev) => [...prev, ...page.data]);
      setNextCursor(page.nextCursor);
    } finally {
      setLoadingMore(false);
    }
  }, [nextCursor]);

  return (
    <div className="flex flex-col gap-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight text-ink">Payments</h1>
        <p className="mt-1 text-ink-muted">Recent payment activity for this merchant.</p>
      </header>

      {error ? (
        <ErrorState
          title="We couldn't load payments."
          description={error.message}
          onRetry={reload}
        />
      ) : loading ? (
        <div className="flex flex-col gap-2">
          {Array.from({ length: 6 }, (_, i) => (
            <Skeleton key={i} className="h-12" />
          ))}
        </div>
      ) : payments.length === 0 ? (
        <EmptyState
          icon={<CreditCard className="h-6 w-6" />}
          title="No payments yet."
          description="Once payments come through Razorpay Test Mode, they'll show up here."
        />
      ) : (
        <>
          <PaymentsTable payments={payments} />
          {nextCursor ? (
            <div className="flex justify-center">
              <Button variant="secondary" onClick={loadMore} disabled={loadingMore}>
                {loadingMore ? "Loading…" : "Load more"}
              </Button>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}
