"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { DetectionSeverity, Issue } from "@paysherlock/types";
import { getIssues } from "@/lib/api/issues";

// In-app-only notifications for newly detected issues (Phase 4 brief
// section 31) — no email/Slack/WhatsApp/SMS. Dedup (section 32): a given
// issue notifies once when first seen, and again only if its severity
// escalates — never on every routine metric update. "Seen" state is kept
// in sessionStorage (not localStorage), consistent with this app's
// existing session-only-persistence honesty convention (see
// lib/history/sessionHistory.ts) — Phase 2/4 have no server-side
// "notifications sent" ledger, so this doesn't pretend to be permanent.

const STORAGE_KEY = "paysherlock.seen-issues.v1";
const POLL_INTERVAL_MS = 30_000;
const AUTO_DISMISS_MS = 12_000;

const SEVERITY_RANK: Record<DetectionSeverity, number> = { INFO: 0, WARNING: 1, CRITICAL: 2 };

type SeenMap = Record<string, DetectionSeverity>;

function readSeen(): SeenMap {
  if (typeof window === "undefined") return {};
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as SeenMap) : {};
  } catch {
    return {};
  }
}

function writeSeen(map: SeenMap): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(map));
  } catch {
    // Notifications are a convenience, never critical — fail silently.
  }
}

export interface IssueNotification {
  key: string;
  issue: Issue;
  kind: "new" | "escalated";
}

export function useIssueNotifications(): {
  notifications: IssueNotification[];
  dismiss: (key: string) => void;
} {
  const [notifications, setNotifications] = useState<IssueNotification[]>([]);
  const seenRef = useRef<SeenMap>({});
  const primedRef = useRef(false);

  const dismiss = useCallback((key: string) => {
    setNotifications((current) => current.filter((n) => n.key !== key));
  }, []);

  useEffect(() => {
    seenRef.current = readSeen();
    let cancelled = false;

    async function poll() {
      let page;
      try {
        page = await getIssues({ limit: 20 });
      } catch {
        return; // Never surface a polling failure as a notification error.
      }
      if (cancelled) return;

      // The very first poll of a fresh session establishes the baseline —
      // it never fires a flood of notifications for issues that already
      // existed before this tab opened.
      const wasPrimed = primedRef.current;
      const fresh: IssueNotification[] = [];
      const nextSeen: SeenMap = { ...seenRef.current };

      for (const issue of page.data) {
        if (issue.status === "DISMISSED") continue;
        const previousSeverity = seenRef.current[issue.id];
        if (wasPrimed) {
          if (previousSeverity === undefined) {
            fresh.push({ key: `${issue.id}:new`, issue, kind: "new" });
          } else if (SEVERITY_RANK[issue.severity] > SEVERITY_RANK[previousSeverity]) {
            fresh.push({
              key: `${issue.id}:escalated:${issue.severity}`,
              issue,
              kind: "escalated",
            });
          }
        }
        nextSeen[issue.id] = issue.severity;
      }

      seenRef.current = nextSeen;
      writeSeen(nextSeen);
      primedRef.current = true;

      if (fresh.length > 0) {
        setNotifications((current) => [...current, ...fresh]);
        for (const notification of fresh) {
          setTimeout(() => dismiss(notification.key), AUTO_DISMISS_MS);
        }
      }
    }

    void poll();
    const interval = setInterval(() => void poll(), POLL_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(interval);
    };
  }, [dismiss]);

  return { notifications, dismiss };
}
