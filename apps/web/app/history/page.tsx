"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { History as HistoryIcon } from "lucide-react";
import {
  clearInvestigationHistory,
  getInvestigationHistory,
  type HistoryEntry,
} from "@/lib/history/sessionHistory";
import { formatCompactINR } from "@/lib/formatters/currency";
import { formatRelativeToNow } from "@/lib/formatters/date";
import { Button } from "@/components/ui/Button";
import { EmptyState } from "@/components/ui/EmptyState";
import { Drawer } from "@/components/ui/Drawer";
import { ResultView } from "@/components/investigation/ResultView";

export default function HistoryPage() {
  const router = useRouter();
  // Lazy initializer: reads sessionStorage once on mount (guarded for SSR
  // inside getInvestigationHistory itself) — no effect needed.
  const [entries, setEntries] = useState<HistoryEntry[]>(() => getInvestigationHistory());
  const [selected, setSelected] = useState<HistoryEntry | null>(null);

  function handleClear() {
    clearInvestigationHistory();
    setEntries([]);
  }

  return (
    <div className="flex flex-col gap-6">
      <header className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight text-ink">Investigations</h1>
          <p className="mt-1 text-ink-muted">
            Stored in your browser for this session only — not saved on the server.
          </p>
        </div>
        {entries.length > 0 ? (
          <Button variant="ghost" size="sm" onClick={handleClear}>
            Clear history
          </Button>
        ) : null}
      </header>

      {entries.length === 0 ? (
        <EmptyState
          icon={<HistoryIcon className="h-6 w-6" />}
          title="No investigations yet this session."
          description="Investigations you run will appear here until you close this tab."
        />
      ) : (
        <div className="overflow-x-auto rounded-lg border border-border">
          <table className="w-full min-w-[560px] border-collapse text-sm">
            <thead>
              <tr className="border-b border-border bg-surface-2 text-left text-xs font-medium uppercase tracking-wide text-ink-faint">
                <th scope="col" className="px-4 py-3">
                  Question
                </th>
                <th scope="col" className="px-4 py-3">
                  Result
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Impact
                </th>
                <th scope="col" className="px-4 py-3 text-right">
                  Asked
                </th>
              </tr>
            </thead>
            <tbody>
              {entries.map((entry) => (
                <tr
                  key={entry.id}
                  tabIndex={0}
                  role="button"
                  onClick={() => setSelected(entry)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      setSelected(entry);
                    }
                  }}
                  className="cursor-pointer border-b border-border bg-surface transition-colors last:border-none hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-emerald-strong"
                >
                  <td className="px-4 py-3 text-ink">{entry.question}</td>
                  <td className="px-4 py-3 text-ink-muted">
                    {entry.result.rootCause ?? "No anomaly"}
                  </td>
                  <td className="px-4 py-3 text-right tabular-nums text-ink-muted">
                    {entry.result.businessImpact
                      ? formatCompactINR(entry.result.businessImpact.estimatedImpactMinorUnits)
                      : "—"}
                  </td>
                  <td className="px-4 py-3 text-right text-ink-faint">
                    {formatRelativeToNow(entry.askedAt)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <Drawer
        open={selected !== null}
        onOpenChange={(open) => !open && setSelected(null)}
        title="Investigation"
      >
        {selected ? (
          <ResultView
            result={selected.result}
            onFollowUp={(question) => {
              setSelected(null);
              router.push(`/investigate?q=${encodeURIComponent(question)}`);
            }}
          />
        ) : null}
      </Drawer>
    </div>
  );
}
