import { Search } from "lucide-react";

export function Logo({ className }: { className?: string }) {
  return (
    <div className={className}>
      <span className="relative inline-flex h-7 w-7 items-center justify-center rounded-md bg-emerald-soft text-emerald">
        <Search className="h-4 w-4" strokeWidth={2.25} aria-hidden="true" />
      </span>
    </div>
  );
}
