import { AlertTriangle } from "lucide-react";
import { Button } from "./Button";
import { cn } from "@/lib/utils/cn";

export interface ErrorStateProps {
  title: string;
  description?: string;
  /** e.g. an investigationId — safe, non-sensitive context. Never a stack
   * trace, secret, or filesystem path (Phase 3 brief section 29). */
  detail?: string;
  onRetry?: () => void;
  className?: string;
}

export function ErrorState({ title, description, detail, onRetry, className }: ErrorStateProps) {
  return (
    <div
      role="alert"
      className={cn(
        "flex flex-col items-center gap-3 rounded-lg border border-red-strong/30 bg-red-soft px-6 py-10 text-center",
        className,
      )}
    >
      <AlertTriangle className="h-8 w-8 text-red" aria-hidden="true" />
      <h3 className="text-base font-medium text-ink">{title}</h3>
      {description ? <p className="max-w-sm text-sm text-ink-muted">{description}</p> : null}
      {onRetry ? (
        <Button variant="secondary" size="sm" onClick={onRetry} className="mt-1">
          Try again
        </Button>
      ) : null}
      {detail ? <p className="mt-1 text-xs text-ink-faint">{detail}</p> : null}
    </div>
  );
}
