"use client";

import { useState } from "react";
import { CheckCircle2 } from "lucide-react";
import type { Evidence } from "@paysherlock/types";
import { humanizeMetric } from "./humanizeMetric";
import { EvidenceDrawer } from "./EvidenceDrawer";
import { cn } from "@/lib/utils/cn";

export interface EvidenceListProps {
  evidence: Evidence[];
}

function isRateLike(value: number): boolean {
  return value >= 0 && value <= 1;
}

export function EvidenceList({ evidence }: EvidenceListProps) {
  const [selected, setSelected] = useState<Evidence | null>(null);

  if (evidence.length === 0) return null;

  const rateEvidence = evidence.filter(
    (item) =>
      item.baselineValue !== undefined &&
      isRateLike(item.observedValue) &&
      isRateLike(item.baselineValue),
  );
  const otherEvidence = evidence.filter((item) => !rateEvidence.includes(item));

  return (
    <section className="flex flex-col gap-4">
      <h2 className="text-lg font-medium text-ink">Evidence</h2>

      {rateEvidence.map((item) => (
        <div key={item.id} className="rounded-lg border border-border bg-surface p-5">
          <p className="text-sm font-medium text-ink">{humanizeMetric(item.metric)}</p>
          <div className="mt-3 flex items-center justify-between text-sm text-ink-muted">
            <span>
              Baseline{" "}
              <span className="font-medium tabular-nums text-ink">
                {((item.baselineValue ?? 0) * 100).toFixed(1)}%
              </span>
            </span>
            <span>
              Current{" "}
              <span className="font-medium tabular-nums text-ink">
                {(item.observedValue * 100).toFixed(1)}%
              </span>
            </span>
          </div>
          <div className="relative mt-2 h-2 overflow-hidden rounded-full bg-surface-3">
            <div
              className="absolute inset-y-0 left-0 h-full rounded-full bg-ink-faint/50"
              style={{ width: `${Math.min((item.baselineValue ?? 0) * 100, 100)}%` }}
              aria-hidden="true"
            />
            <div
              className="absolute inset-y-0 left-0 h-full rounded-full bg-red-strong"
              style={{ width: `${Math.min(item.observedValue * 100, 100)}%` }}
              aria-hidden="true"
            />
          </div>
          {item.comparison ? (
            <p className="mt-2 text-sm font-medium text-amber">{item.comparison}</p>
          ) : null}
        </div>
      ))}

      {otherEvidence.length > 0 ? (
        <ul className="flex flex-col gap-2">
          {otherEvidence.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                onClick={() => setSelected(item)}
                className={cn(
                  "flex w-full items-start gap-2.5 rounded-md border border-border bg-surface p-3 text-left text-sm",
                  "transition-colors hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong",
                )}
              >
                <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald" aria-hidden="true" />
                <span className="text-ink">{item.comparison ?? humanizeMetric(item.metric)}</span>
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      <EvidenceDrawer evidence={selected} onClose={() => setSelected(null)} />
    </section>
  );
}
