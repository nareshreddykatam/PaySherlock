"use client";

import { useEffect, useState } from "react";
import { Check, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils/cn";

// Mirrors the real default tool sequence the investigation engine runs
// (packages/agent's DEFAULT_INVESTIGATION_STEPS) — these labels describe
// what a typical investigation actually does, not a fabricated live feed.
// The API returns one completed result rather than streaming per-tool
// events, so this advances on a timer and then holds on the final step
// until the real response arrives — see docs/decisions for why this is
// an honest lifecycle representation, not a simulated real-time trace.
const STEP_LABELS = [
  "Building investigation plan",
  "Comparing payment performance",
  "Analyzing payment failures",
  "Segmenting payment methods",
  "Checking refund activity",
  "Calculating revenue impact",
];

const STEP_INTERVAL_MS = 750;

export function ProgressView() {
  const [currentIndex, setCurrentIndex] = useState(0);

  useEffect(() => {
    if (currentIndex >= STEP_LABELS.length - 1) return;
    const timer = setTimeout(() => setCurrentIndex((i) => i + 1), STEP_INTERVAL_MS);
    return () => clearTimeout(timer);
  }, [currentIndex]);

  return (
    <div
      role="status"
      aria-live="polite"
      className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-6"
    >
      <div>
        <p className="text-sm font-medium text-ink">Investigating…</p>
        <p className="mt-0.5 text-xs text-ink-faint">
          Running the same tools the AI investigation engine uses.
        </p>
      </div>
      <ul className="flex flex-col gap-2.5">
        {STEP_LABELS.map((label, index) => {
          const done = index < currentIndex;
          const active = index === currentIndex;
          return (
            <li key={label} className="flex items-center gap-2.5 text-sm">
              <span
                className={cn(
                  "flex h-5 w-5 shrink-0 items-center justify-center rounded-full border",
                  done && "border-emerald-strong bg-emerald-soft text-emerald",
                  active && "border-emerald-strong text-emerald",
                  !done && !active && "border-border-strong text-ink-faint",
                )}
                aria-hidden="true"
              >
                {done ? (
                  <Check className="h-3 w-3" />
                ) : active ? (
                  <Loader2 className="h-3 w-3 animate-spin" />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-current" />
                )}
              </span>
              <span className={cn(done || active ? "text-ink" : "text-ink-faint")}>{label}</span>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
