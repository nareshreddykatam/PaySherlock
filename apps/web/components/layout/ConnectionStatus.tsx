"use client";

import { useEffect, useState } from "react";
import { getHealth } from "@/lib/api/health";
import { StatusDot } from "@/components/ui/StatusDot";

type ConnectionState = "checking" | "connected" | "disconnected";

/** A genuine connectivity indicator — pings GET /health once on mount and
 * reflects the real result, never a hard-coded "Connected". */
export function ConnectionStatus() {
  const [state, setState] = useState<ConnectionState>("checking");

  useEffect(() => {
    let cancelled = false;
    getHealth()
      .then(() => {
        if (!cancelled) setState("connected");
      })
      .catch(() => {
        if (!cancelled) setState("disconnected");
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (state === "checking") {
    return <StatusDot tone="neutral" label="Checking…" />;
  }
  if (state === "connected") {
    return <StatusDot tone="emerald" label="Connected" />;
  }
  return <StatusDot tone="red" label="API unreachable" />;
}
