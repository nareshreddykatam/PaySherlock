import { ArrowUp, ArrowDown } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/Card";
import { cn } from "@/lib/utils/cn";

export interface MetricChange {
  /** Raw signed value, e.g. 0.084 for "+8.4%" — sign determines the arrow. */
  value: number;
  label: string;
  /** Whether an increase is good news for this metric — revenue up is
   * positive, failure rate up is negative. Independent of `value`'s sign. */
  sentiment: "positive" | "negative";
}

export interface MetricCardProps {
  label: string;
  value: string;
  change?: MetricChange;
  footnote?: string;
  className?: string;
}

export function MetricCard({ label, value, change, footnote, className }: MetricCardProps) {
  const isIncrease = (change?.value ?? 0) >= 0;
  const isGoodNews = change
    ? (isIncrease && change.sentiment === "positive") ||
      (!isIncrease && change.sentiment === "negative")
    : null;

  return (
    <Card className={className}>
      <CardHeader>
        <CardTitle>{label}</CardTitle>
      </CardHeader>
      <CardContent className="pt-2">
        <p className="font-sans text-2xl font-semibold tabular-nums text-ink">{value}</p>
        {change ? (
          <p
            className={cn(
              "mt-2 flex items-center gap-1 text-sm font-medium",
              isGoodNews ? "text-emerald" : "text-amber",
            )}
          >
            {isIncrease ? (
              <ArrowUp className="h-3.5 w-3.5" aria-hidden="true" />
            ) : (
              <ArrowDown className="h-3.5 w-3.5" aria-hidden="true" />
            )}
            <span className="tabular-nums">{change.label}</span>
          </p>
        ) : footnote ? (
          <p className="mt-2 text-sm text-ink-muted">{footnote}</p>
        ) : null}
      </CardContent>
    </Card>
  );
}
