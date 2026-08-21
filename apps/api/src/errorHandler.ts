import type { FastifyError, FastifyInstance } from "fastify";
import { isAppError } from "@paysherlock/types";

/**
 * Centralized error → HTTP response mapping. Never leaks stack traces or
 * internal details to clients — only a stable error code and a safe
 * message. Unexpected (non-App, non-Fastify) errors are logged in full
 * server-side but returned to the client as a generic 500.
 */
export function registerErrorHandler(app: FastifyInstance): void {
  app.setErrorHandler((error, request, reply) => {
    if (isAppError(error)) {
      request.log.warn({ code: error.code }, error.message);
      reply.status(error.httpStatus).send({ error: { code: error.code, message: error.message } });
      return;
    }

    // Fastify's own errors (body-parse failures, route schema validation)
    // already carry a safe statusCode/message — surface those as-is.
    const fastifyError = error as FastifyError;
    if (typeof fastifyError.statusCode === "number" && fastifyError.statusCode < 500) {
      reply.status(fastifyError.statusCode).send({
        error: { code: fastifyError.code ?? "BAD_REQUEST", message: fastifyError.message },
      });
      return;
    }

    request.log.error(error);
    reply.status(500).send({ error: { code: "INTERNAL_ERROR", message: "Internal server error" } });
  });

  app.setNotFoundHandler((_request, reply) => {
    reply.status(404).send({ error: { code: "NOT_FOUND", message: "Route not found" } });
  });
}
