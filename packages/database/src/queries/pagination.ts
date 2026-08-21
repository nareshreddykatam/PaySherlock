export interface Page<T> {
  items: T[];
  nextCursor: string | null;
}

export interface CursorPageParams {
  limit?: number;
  cursor?: string | null;
}

export const DEFAULT_PAGE_LIMIT = 20;
export const MAX_PAGE_LIMIT = 100;

export function clampLimit(limit: number | undefined): number {
  return Math.min(Math.max(limit ?? DEFAULT_PAGE_LIMIT, 1), MAX_PAGE_LIMIT);
}

/** Turns an "N+1 rows fetched" result into a page + cursor for the next call. */
export function toPage<T extends { id: string }>(rows: T[], limit: number): Page<T> {
  const hasMore = rows.length > limit;
  const items = hasMore ? rows.slice(0, limit) : rows;
  const last = items[items.length - 1];
  return { items, nextCursor: hasMore && last ? last.id : null };
}
