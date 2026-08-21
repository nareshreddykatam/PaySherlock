import { afterEach, describe, expect, it, vi } from "vitest";
import { RazorpayClient } from "../client.js";
import {
  RazorpayApiError,
  RazorpayConfigError,
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
