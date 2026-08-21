import { cn } from "@/lib/utils/cn";

export type StatusTone = "emerald" | "amber" | "red" | "neutral";

const TONE_CLASSES: Record<StatusTone, string> = {
  emerald: "bg-emerald-strong",
  amber: "bg-amber-strong",
  red: "bg-red-strong",
  neutral: "bg-ink-faint",
};

export interface StatusDotProps {
  tone: StatusTone;
  label: string;
  className?: string;
}

/** A dot + text label together — never color alone conveys the status
 * (Phase 3 brief section 26). */
export function StatusDot({ tone, label, className }: StatusDotProps) {
  return (
    <span className={cn("inline-flex items-center gap-2 text-sm text-ink-muted", className)}>
      <span
        className={cn("h-1.5 w-1.5 shrink-0 rounded-full", TONE_CLASSES[tone])}
        aria-hidden="true"
      />
      {label}
    </span>
  );
}
