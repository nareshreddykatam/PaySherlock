import { vi } from "vitest";
import type { ToolContext } from "../types.js";

/** Same mocking approach as packages/database's tests — see
 * packages/database/src/__tests__/fixtures.ts for the rationale. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function createMockDb(): any {
  return {
    payment: {
      aggregate: vi.fn(),
      groupBy: vi.fn(),
      findMany: vi.fn(),
    },
    refund: {
      aggregate: vi.fn(),
    },
  };
}

export function createToolContext(db: unknown, merchantId = "merchant-1"): ToolContext {
  return { merchantId, db: db as ToolContext["db"] };
}
