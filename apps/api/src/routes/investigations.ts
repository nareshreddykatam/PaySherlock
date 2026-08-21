import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveMerchant } from "@paysherlock/database";
import { ValidationError } from "@paysherlock/types";
import type { ServerDeps } from "../server.js";

const CreateInvestigationSchema = z.object({
  question: z.string().min(1).max(500),
});

export function registerInvestigationRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.post("/investigations", async (request) => {
    const body = CreateInvestigationSchema.safeParse(request.body);
    if (!body.success) {
      throw new ValidationError(
        body.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }

    // Merchant scoping is derived server-side, never from client input —
    // CreateInvestigationSchema has no merchantId field for a client to
    // even attempt to supply one. See docs/decisions.
    const merchant = await resolveMerchant(deps.db, {});

    return deps.runInvestigation({
      question: body.data.question,
      merchantId: merchant.id,
    });
  });
}
