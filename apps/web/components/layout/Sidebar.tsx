"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutGrid,
  Search,
  CreditCard,
  AlertTriangle,
  ShieldCheck,
  History,
  Settings,
} from "lucide-react";
import { Logo } from "./Logo";
import { ConnectionStatus } from "./ConnectionStatus";
import { cn } from "@/lib/utils/cn";

const NAV_ITEMS = [
  { href: "/", label: "Overview", icon: LayoutGrid },
  { href: "/investigate", label: "Investigate", icon: Search },
  { href: "/payments", label: "Payments", icon: CreditCard },
  { href: "/issues", label: "Issues", icon: AlertTriangle },
  { href: "/recommendations", label: "Recommendations", icon: ShieldCheck },
  { href: "/history", label: "History", icon: History },
] as const;

export interface SidebarProps {
  className?: string;
  onNavigate?: () => void;
}

export function Sidebar({ className, onNavigate }: SidebarProps) {
  const pathname = usePathname();

  return (
    <nav
      aria-label="Primary"
      className={cn("flex h-full flex-col gap-6 border-r border-border bg-surface p-4", className)}
    >
      <Link href="/" className="flex items-center gap-2 px-2" onClick={onNavigate}>
        <Logo />
        <span className="text-sm font-semibold tracking-tight text-ink">PaySherlock</span>
      </Link>

      <ul className="flex flex-1 flex-col gap-1">
        {NAV_ITEMS.map((item) => {
          const isActive = item.href === "/" ? pathname === "/" : pathname.startsWith(item.href);
          const Icon = item.icon;
          return (
            <li key={item.href}>
              <Link
                href={item.href}
                onClick={onNavigate}
                aria-current={isActive ? "page" : undefined}
                className={cn(
                  "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium transition-colors",
                  "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong",
                  isActive
                    ? "bg-surface-2 text-ink"
                    : "text-ink-muted hover:bg-surface-2 hover:text-ink",
                )}
              >
                <Icon className="h-4 w-4" aria-hidden="true" />
                {item.label}
              </Link>
            </li>
          );
        })}
      </ul>

      <div className="flex flex-col gap-1 border-t border-border pt-3">
        <span
          aria-disabled="true"
          className="flex cursor-not-allowed items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-ink-faint"
          title="Settings isn't available yet"
        >
          <Settings className="h-4 w-4" aria-hidden="true" />
          Settings
        </span>
        <div className="px-3 pt-2">
          <ConnectionStatus />
        </div>
      </div>
    </nav>
  );
}
