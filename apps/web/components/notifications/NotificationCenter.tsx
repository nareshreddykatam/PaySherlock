"use client";

import Link from "next/link";
import { AlertCircle, TrendingUp, X } from "lucide-react";
import { useIssueNotifications } from "@/lib/notifications/useIssueNotifications";
import { formatCompactINR } from "@/lib/formatters/currency";

/** Mounted once in AppShell — polls for newly-detected or
 * severity-escalated issues and surfaces them as dismissible, auto-expiring
 * toasts. In-app only (Phase 4 brief section 31): no email/Slack/SMS. */
export function NotificationCenter() {
  const { notifications, dismiss } = useIssueNotifications();

  if (notifications.length === 0) return null;

  return (
    <div className="pointer-events-none fixed inset-x-4 top-16 z-40 flex flex-col items-stretch gap-2 sm:inset-x-auto sm:right-4 sm:w-96">
      {notifications.map((notification) => {
        const Icon = notification.kind === "escalated" ? TrendingUp : AlertCircle;
        const heading =
          notification.kind === "escalated"
            ? "An issue got more severe"
            : "PaySherlock found something unusual";
        return (
          <div
            key={notification.key}
            role="status"
            className="pointer-events-auto rounded-lg border border-border-strong bg-surface-2 p-4 shadow-2xl"
          >
            <div className="flex items-start gap-3">
              <Icon className="mt-0.5 h-5 w-5 shrink-0 text-emerald" aria-hidden="true" />
              <div className="min-w-0 flex-1">
                <p className="text-sm font-medium text-ink">{heading}</p>
                <p className="mt-1 text-sm text-ink-muted">{notification.issue.title}</p>
                {notification.issue.estimatedImpactMinorUnits !== null &&
                notification.issue.estimatedImpactMinorUnits > 0 ? (
                  <p className="mt-1 text-xs text-ink-faint">
                    Estimated impact:{" "}
                    {formatCompactINR(notification.issue.estimatedImpactMinorUnits)}
                  </p>
                ) : null}
                <Link
                  href={`/issues/${notification.issue.id}`}
                  onClick={() => dismiss(notification.key)}
                  className="mt-2 inline-block text-sm font-medium text-emerald hover:text-emerald-strong focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
                >
                  View investigation →
                </Link>
              </div>
              <button
                type="button"
                aria-label="Dismiss notification"
                onClick={() => dismiss(notification.key)}
                className="shrink-0 text-ink-faint hover:text-ink focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-strong rounded-sm"
              >
                <X className="h-4 w-4" />
              </button>
            </div>
          </div>
        );
      })}
    </div>
  );
}
