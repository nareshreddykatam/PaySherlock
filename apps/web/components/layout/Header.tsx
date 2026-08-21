"use client";

import { Menu, ChevronDown } from "lucide-react";
import { Badge } from "@/components/ui/Badge";

export interface HeaderProps {
  onOpenMobileNav: () => void;
}

export function Header({ onOpenMobileNav }: HeaderProps) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between gap-4 border-b border-border bg-surface px-4 md:px-6">
      <div className="flex items-center gap-3">
        <button
          type="button"
          onClick={onOpenMobileNav}
          aria-label="Open navigation menu"
          className="flex h-9 w-9 items-center justify-center rounded-md text-ink-muted hover:bg-surface-2 hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong lg:hidden"
        >
          <Menu className="h-5 w-5" />
        </button>
        <Badge tone="amber" className="hidden sm:inline-flex">
          Test Mode
        </Badge>
      </div>

      <button
        type="button"
        className="flex items-center gap-2 rounded-md border border-border-strong bg-surface-2 px-3 py-1.5 text-sm text-ink transition-colors hover:bg-surface-3 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong"
        aria-haspopup="true"
        title="Merchant selection isn't available yet — single merchant only"
      >
        <span className="max-w-[10rem] truncate">Test Merchant</span>
        <ChevronDown className="h-3.5 w-3.5 text-ink-muted" aria-hidden="true" />
      </button>
    </header>
  );
}
