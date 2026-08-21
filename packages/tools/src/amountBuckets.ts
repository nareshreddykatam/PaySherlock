// Amount buckets for `segment_payments(dimension="amount_bucket")`. Ranges
// are in minor units (paise) to match how amounts are stored — see
// docs/decisions on money representation.
export interface AmountBucket {
  label: string;
  minMinorUnits: number;
  maxMinorUnits: number | null;
}

export const AMOUNT_BUCKETS: AmountBucket[] = [
  { label: "<₹100", minMinorUnits: 0, maxMinorUnits: 10_000 },
  { label: "₹100-500", minMinorUnits: 10_000, maxMinorUnits: 50_000 },
  { label: "₹500-2,000", minMinorUnits: 50_000, maxMinorUnits: 200_000 },
  { label: "₹2,000-10,000", minMinorUnits: 200_000, maxMinorUnits: 1_000_000 },
  { label: "₹10,000+", minMinorUnits: 1_000_000, maxMinorUnits: null },
];

export function bucketForAmount(amountMinorUnits: number): AmountBucket {
  return (
    AMOUNT_BUCKETS.find(
      (bucket) =>
        amountMinorUnits >= bucket.minMinorUnits &&
        (bucket.maxMinorUnits === null || amountMinorUnits < bucket.maxMinorUnits),
    ) ?? AMOUNT_BUCKETS[AMOUNT_BUCKETS.length - 1]!
  );
}

export function bucketAmounts(amounts: number[]): Map<string, { count: number; amount: number }> {
  const buckets = new Map<string, { count: number; amount: number }>();
  for (const bucket of AMOUNT_BUCKETS) {
    buckets.set(bucket.label, { count: 0, amount: 0 });
  }
  for (const amount of amounts) {
    const label = bucketForAmount(amount).label;
    const entry = buckets.get(label)!;
    entry.count += 1;
    entry.amount += amount;
  }
  return buckets;
}
