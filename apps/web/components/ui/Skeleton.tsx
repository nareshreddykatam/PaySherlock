import type { HTMLAttributes } from "react";
import { cn } from "@/lib/utils/cn";

/** A meaningful placeholder shape, not a generic spinner — see Phase 3
 * brief section 28. Respects prefers-reduced-motion via globals.css. */
export function Skeleton({ className, ...props }: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("animate-pulse rounded-md bg-surface-2", className)}
      role="presentation"
      {...props}
    />
  );
}
