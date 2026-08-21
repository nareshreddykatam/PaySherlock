"use client";

import { useCallback, useEffect, useRef, useState } from "react";

export interface AsyncState<T> {
  data: T | undefined;
  error: Error | undefined;
  loading: boolean;
  /** Re-runs the query, e.g. for a "Try again" button. */
  reload: () => void;
}

/** Minimal fetch-on-mount hook shared by every API-backed page. Deliberately
 * not a caching/data library (SWR/react-query) — the app's data needs are
 * simple enough that the extra dependency isn't worth it. */
export function useApiQuery<T>(fn: () => Promise<T>, deps: unknown[] = []): AsyncState<T> {
  const [data, setData] = useState<T>();
  const [error, setError] = useState<Error>();
  const [loading, setLoading] = useState(true);
  const [reloadKey, setReloadKey] = useState(0);

  const fnRef = useRef(fn);
  // Keep the ref pointed at the latest callback via an effect (not a
  // render-time mutation) — react-hooks/refs forbids writing to a ref
  // while rendering.
  useEffect(() => {
    fnRef.current = fn;
  });

  useEffect(() => {
    let cancelled = false;
    // Fetch-on-mount is the whole point of this hook — these setState
    // calls are the effect's job, not a side effect to avoid.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setLoading(true);
    setError(undefined);

    fnRef
      .current()
      .then((result) => {
        if (!cancelled) setData(result);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err : new Error(String(err)));
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });

    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, reloadKey]);

  const reload = useCallback(() => setReloadKey((k) => k + 1), []);

  return { data, error, loading, reload };
}
