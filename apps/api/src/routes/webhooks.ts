import type { FastifyInstance } from "fastify";
import { ValidationError } from "@paysherlock/types";
import { processWebhook } from "../services/webhookProcessor.js";
import type { ServerDeps } from "../server.js";

export function registerWebhookRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post("/webhooks/razorpay", async (request) => {
    if (request.rawBody === undefined) {
      throw new ValidationError("Missing request body");
    }

    const result = await processWebhook({
      db: deps.db,
      rawBody: request.rawBody,
      headers: request.headers as Record<string, string | string[] | undefined>,
      webhookSecret: deps.webhookSecret,
    });

    request.log.info(
      { eventType: result.eventType, status: result.status },
      "razorpay webhook processed",
    );

    return { received: true, status: result.status };
  });
}
