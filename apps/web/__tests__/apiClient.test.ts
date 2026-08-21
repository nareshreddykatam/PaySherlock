import { afterEach, describe, expect, it, vi } from "vitest";
import { apiFetch, ApiError } from "@/lib/api/client";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("apiFetch", () => {
  it("returns the parsed JSON body on a successful response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: true,
        text: () => Promise.resolve(JSON.stringify({ status: "ok" })),
      }),
    );

    const result = await apiFetch<{ status: string }>("/health");
    expect(result).toEqual({ status: "ok" });
  });

  it("throws an ApiError carrying the API's own error code/message on a non-2xx response", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 400,
        text: () =>
          Promise.resolve(
            JSON.stringify({ error: { code: "VALIDATION_ERROR", message: "question: Required" } }),
          ),
      }),
    );

    const failure = await apiFetch("/investigations").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).status).toBe(400);
    expect((failure as ApiError).code).toBe("VALIDATION_ERROR");
    expect((failure as ApiError).message).toBe("question: Required");
  });

  it("throws a safe ApiError (not a raw exception) when the network request itself fails", async () => {
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("connection refused")));

    const failure = await apiFetch("/health").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(ApiError);
    expect((failure as ApiError).code).toBe("NETWORK_ERROR");
    expect((failure as ApiError).message).not.toContain("connection refused");
  });

  it("never leaks a raw stack trace or internal detail in the thrown error message", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn().mockResolvedValue({
        ok: false,
        status: 500,
        text: () => Promise.resolve("Internal Server Error\n  at file:///secret/path.js:42"),
      }),
    );

    const failure = await apiFetch("/investigations").catch((error: unknown) => error);
    expect((failure as ApiError).message).toBe("The request failed.");
  });
});
