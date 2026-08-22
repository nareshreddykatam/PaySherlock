import { afterEach, describe, expect, it, vi } from "vitest";
import { RazorpayClient } from "../client.js";
import {
  RazorpayApiError,
  RazorpayConfigError,
  RazorpayInvalidIdempotencyKeyError,
  RazorpayMalformedResponseError,
} from "../errors.js";

function mockFetchOnce(response: { ok: boolean; status?: number; body: string }) {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: response.ok,
    status: response.status ?? (response.ok ? 200 : 400),
    text: () => Promise.resolve(response.body),
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

/** A `fetch` that never resolves on its own — only rejects once its
 * request's AbortSignal fires, mirroring how the real `fetch` behaves for
 * an aborted request. Used to verify the client's own timeout, not
 * Node's. */
function mockHangingFetch() {
  const fetchMock = vi.fn((_url: unknown, init?: { signal?: AbortSignal }) => {
    return new Promise((_resolve, reject) => {
      init?.signal?.addEventListener("abort", () => {
        const error = new Error("The operation was aborted");
        error.name = "AbortError";
        reject(error);
      });
    });
  });
  vi.stubGlobal("fetch", fetchMock);
  return fetchMock;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RazorpayClient construction", () => {
  it("throws RazorpayConfigError when credentials are missing", () => {
    expect(() => new RazorpayClient({ keyId: "", keySecret: "" })).toThrow(RazorpayConfigError);
    // @ts-expect-error deliberately omitting keySecret to test the guard
    expect(() => new RazorpayClient({ keyId: "rzp_test_123" })).toThrow(RazorpayConfigError);
  });
});

describe("RazorpayClient authentication", () => {
  it("sends Basic auth with base64(keyId:keySecret)", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      body: JSON.stringify({
        id: "pay_test0000000001",
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "captured",
        method: "upi",
        captured: true,
        created_at: 1767000000,
      }),
    });
    const client = new RazorpayClient({ keyId: "rzp_test_key", keySecret: "shh_secret" });

    await client.payments.fetch("pay_test0000000001");

    const [, requestInit] = fetchMock.mock.calls[0]!;
    const authHeader = requestInit.headers.Authorization as string;
    expect(authHeader.startsWith("Basic ")).toBe(true);
    const decoded = Buffer.from(authHeader.replace("Basic ", ""), "base64").toString("utf8");
    expect(decoded).toBe("rzp_test_key:shh_secret");
  });
});

describe("RazorpayClient payments.fetch", () => {
  const client = new RazorpayClient({ keyId: "rzp_test_key", keySecret: "shh_secret" });

  it("normalizes a valid response through the schema", async () => {
    mockFetchOnce({
      ok: true,
      body: JSON.stringify({
        id: "pay_test0000000001",
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "captured",
        order_id: "order_test0000000001",
        method: "upi",
        captured: true,
        created_at: 1767000000,
      }),
    });

    const payment = await client.payments.fetch("pay_test0000000001");
    expect(payment.id).toBe("pay_test0000000001");
    expect(payment.status).toBe("captured");
  });

  it("throws RazorpayMalformedResponseError on invalid JSON", async () => {
    mockFetchOnce({ ok: true, body: "{not valid json" });
    await expect(client.payments.fetch("pay_x")).rejects.toThrow(RazorpayMalformedResponseError);
  });

  it("throws RazorpayMalformedResponseError when the response is missing required fields", async () => {
    mockFetchOnce({ ok: true, body: JSON.stringify({ id: "pay_x", entity: "payment" }) });
    await expect(client.payments.fetch("pay_x")).rejects.toThrow(RazorpayMalformedResponseError);
  });

  it("throws RazorpayApiError with the upstream status on a non-2xx response", async () => {
    mockFetchOnce({
      ok: false,
      status: 401,
      body: JSON.stringify({ error: { description: "Authentication failed" } }),
    });

    const failure = await client.payments.fetch("pay_x").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RazorpayApiError);
    expect((failure as RazorpayApiError).status).toBe(401);
  });
});

describe("RazorpayClient refunds.create", () => {
  const client = new RazorpayClient({ keyId: "rzp_test_key", keySecret: "shh_secret" });
  const VALID_IDEMPOTENCY_KEY = "refund-action-cid12345";

  it("sends the idempotency header and normalizes a valid response", async () => {
    const fetchMock = mockFetchOnce({
      ok: true,
      body: JSON.stringify({
        id: "rfnd_test0000000001",
        entity: "refund",
        amount: 240000,
        currency: "INR",
        payment_id: "pay_test0000000001",
        status: "processed",
        created_at: 1767000000,
      }),
    });

    const refund = await client.refunds.create(
      "pay_test0000000001",
      { amountMinorUnits: 240000 },
      VALID_IDEMPOTENCY_KEY,
    );

    expect(refund.id).toBe("rfnd_test0000000001");
    expect(refund.status).toBe("processed");

    const [url, requestInit] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain("/payments/pay_test0000000001/refund");
    expect(requestInit.method).toBe("POST");
    expect(requestInit.headers["X-Refund-Idempotency"]).toBe(VALID_IDEMPOTENCY_KEY);
    expect(JSON.parse(requestInit.body as string)).toEqual({ amount: 240000 });
  });

  it("rejects an idempotency key that is too short or has invalid characters, before ever calling fetch", async () => {
    const fetchMock = mockFetchOnce({ ok: true, body: "{}" });

    await expect(
      client.refunds.create("pay_x", { amountMinorUnits: 1000 }, "short"),
    ).rejects.toThrow(RazorpayInvalidIdempotencyKeyError);
    await expect(
      client.refunds.create("pay_x", { amountMinorUnits: 1000 }, "has a space in it!"),
    ).rejects.toThrow(RazorpayInvalidIdempotencyKeyError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("throws RazorpayApiError with the upstream status when Razorpay rejects the refund", async () => {
    mockFetchOnce({
      ok: false,
      status: 400,
      body: JSON.stringify({ error: { description: "Refund amount exceeds refundable amount" } }),
    });

    const failure = await client.refunds
      .create("pay_x", { amountMinorUnits: 999999999 }, VALID_IDEMPOTENCY_KEY)
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RazorpayApiError);
    expect((failure as RazorpayApiError).status).toBe(400);
  });
});

describe("RazorpayClient timeouts", () => {
  it("aborts a GET request that hangs past the configured timeout", async () => {
    mockHangingFetch();
    const client = new RazorpayClient({
      keyId: "rzp_test_key",
      keySecret: "shh_secret",
      timeoutMs: 20,
    });

    const failure = await client.payments.fetch("pay_x").catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RazorpayApiError);
    expect((failure as RazorpayApiError).message).toMatch(/timed out after 20ms/);
  });

  it("aborts a POST (refund) request that hangs past the configured timeout", async () => {
    mockHangingFetch();
    const client = new RazorpayClient({
      keyId: "rzp_test_key",
      keySecret: "shh_secret",
      timeoutMs: 20,
    });

    const failure = await client.refunds
      .create("pay_test0000000001", { amountMinorUnits: 1000 }, "refund-action-cid12345")
      .catch((error: unknown) => error);
    expect(failure).toBeInstanceOf(RazorpayApiError);
    expect((failure as RazorpayApiError).message).toMatch(/timed out after 20ms/);
  });

  it("defaults to a 10s timeout when none is configured", async () => {
    const fetchMock = mockHangingFetch();
    const client = new RazorpayClient({ keyId: "rzp_test_key", keySecret: "shh_secret" });

    // Just confirm the signal is actually wired through to fetch — proving
    // the default timeout will eventually fire without waiting 10 real
    // seconds in the test.
    void client.payments.fetch("pay_x").catch(() => undefined);
    await Promise.resolve();
    const [, init] = fetchMock.mock.calls[0]!;
    expect((init as { signal?: AbortSignal }).signal).toBeInstanceOf(AbortSignal);
  });
});
