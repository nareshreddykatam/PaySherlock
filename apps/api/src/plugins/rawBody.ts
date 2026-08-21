import type { FastifyError, FastifyInstance } from "fastify";

declare module "fastify" {
  interface FastifyRequest {
    /** The exact bytes of the request body, captured before JSON parsing.
     * Required for Razorpay webhook signature verification, which must be
     * computed over the raw body — never a re-serialized JSON object. */
    rawBody?: string;
  }
}

/**
 * Replaces Fastify's default JSON body parser with one that stashes the raw
 * string on the request before parsing, so downstream handlers (namely the
 * webhook route) can verify signatures against the exact bytes Razorpay
 * sent.
 */
export function registerRawBodyCapture(app: FastifyInstance): void {
  app.addContentTypeParser(
    "application/json",
    { parseAs: "string" },
    (request, body: string | Buffer, done) => {
      const rawBody = typeof body === "string" ? body : body.toString("utf8");
      request.rawBody = rawBody;
      if (rawBody.length === 0) {
        done(null, {});
        return;
      }
      try {
        done(null, JSON.parse(rawBody));
      } catch {
        // Mirror Fastify's own default JSON parser: an invalid body is a
        // client error (400), not a server error.
        const parseError: FastifyError = Object.assign(new Error("Body is not valid JSON"), {
          statusCode: 400,
          code: "FST_ERR_CTP_INVALID_JSON_BODY",
        });
        done(parseError, undefined);
      }
    },
  );
}
