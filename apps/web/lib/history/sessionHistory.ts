"use client";

import type { InvestigationResult } from "@paysherlock/types";

// Phase 2 doesn't persist investigations server-side — there is no history
// endpoint. Rather than fabricate permanence, history here is explicitly
// scoped to the browser tab's session (sessionStorage, not localStorage):
// it survives navigation within the app but clears when the tab closes.
// The History page labels this honestly. See docs/decisions.

const STORAGE_KEY = "paysherlock.investigation-history.v1";
const MAX_ENTRIES = 50;

export interface HistoryEntry {
  id: string;
  question: string;
  askedAt: string;
  result: InvestigationResult;
}

function readStorage(): HistoryEntry[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? (parsed as HistoryEntry[]) : [];
  } catch {
    return [];
  }
}

function writeStorage(entries: HistoryEntry[]): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(entries.slice(0, MAX_ENTRIES)));
  } catch {
    // sessionStorage can throw (private browsing, quota) — history is a
    // convenience, never critical, so fail silently.
  }
}

export function getInvestigationHistory(): HistoryEntry[] {
  return readStorage();
}

export function addInvestigationHistoryEntry(
  question: string,
  result: InvestigationResult,
): HistoryEntry {
  const entry: HistoryEntry = {
    id: result.meta.investigationId,
    question,
    askedAt: new Date().toISOString(),
    result,
  };
  writeStorage([entry, ...readStorage()]);
  return entry;
}

export function clearInvestigationHistory(): void {
  writeStorage([]);
}
