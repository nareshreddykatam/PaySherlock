import type { Evidence } from "@paysherlock/types";
import { Drawer } from "@/components/ui/Drawer";
import { humanizeMetric } from "./humanizeMetric";

export interface EvidenceDrawerProps {
  evidence: Evidence | null;
  onClose: () => void;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between border-b border-border py-3 last:border-none">
      <span className="text-sm text-ink-muted">{label}</span>
      <span className="text-sm font-medium tabular-nums text-ink">{value}</span>
    </div>
  );
}

export function EvidenceDrawer({ evidence, onClose }: EvidenceDrawerProps) {
  return (
    <Drawer
      open={evidence !== null}
      onOpenChange={(open) => !open && onClose()}
      title="Evidence details"
    >
      {evidence ? (
        <div className="flex flex-col">
          <DetailRow label="Source" value={evidence.source} />
          <DetailRow label="Metric" value={humanizeMetric(evidence.metric)} />
          <DetailRow label="Observed" value={String(evidence.observedValue)} />
          {evidence.baselineValue !== undefined ? (
            <DetailRow label="Baseline" value={String(evidence.baselineValue)} />
          ) : null}
          {evidence.comparison ? <DetailRow label="Change" value={evidence.comparison} /> : null}
          {evidence.significance ? (
            <DetailRow label="Significance" value={evidence.significance} />
          ) : null}
        </div>
      ) : null}
    </Drawer>
  );
}
