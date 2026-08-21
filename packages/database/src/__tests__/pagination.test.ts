import { describe, expect, it } from "vitest";
import { clampLimit, toPage } from "../queries/pagination.js";

describe("clampLimit", () => {
  it("defaults to 20 when unset", () => {
    expect(clampLimit(undefined)).toBe(20);
  });

  it("caps at the maximum of 100", () => {
    expect(clampLimit(500)).toBe(100);
  });

  it("floors at 1", () => {
    expect(clampLimit(0)).toBe(1);
    expect(clampLimit(-5)).toBe(1);
  });
});

describe("toPage", () => {
  it("returns null nextCursor when there are no more rows", () => {
    const rows = [{ id: "a" }, { id: "b" }];
    expect(toPage(rows, 5)).toEqual({ items: rows, nextCursor: null });
  });

  it("trims the lookahead row and returns its id as the cursor", () => {
    const rows = [{ id: "a" }, { id: "b" }, { id: "c" }];
    const page = toPage(rows, 2);
    expect(page.items).toEqual([{ id: "a" }, { id: "b" }]);
    expect(page.nextCursor).toBe("b");
  });
});
