import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { resolveMerchant } from "@paysherlock/database";
import { ValidationError } from "@paysherlock/types";
import type { ServerDeps } from "../server.js";
import { generateRecommendationForInvestigation } from "../services/recommendationService.js";

const CreateInvestigationSchema = z.object({
  question: z.string().min(1).max(500),
  /** Our internal Payment.id — set when the merchant investigated a
   * specific payment (e.g. "Investigate this payment" on the Payments
   * page). Never a Razorpay id, and never trusted for anything beyond
   * "which payment might a Phase 5 recommendation concern" — the target
   * payment itself is always re-fetched and re-validated server-side. */
  targetPaymentId: z.string().min(1).optional(),
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

    const result = await deps.runInvestigation({
      question: body.data.question,
      merchantId: merchant.id,
      targetPaymentId: body.data.targetPaymentId,
    });

    // Phase 5: every completed investigation gets exactly one
    // recommendation (REFUND_PAYMENT pending approval, or an
    // already-terminal NO_ACTION) — see recommendationService.ts. The LLM
    // never decides this; it only supplied the summary/rootCause text this
    // reuses.
    const recommendation = await generateRecommendationForInvestigation(deps, {
      merchantId: merchant.id,
      investigation: result,
      targetPaymentId: body.data.targetPaymentId,
    });

    return { ...result, recommendation };
  });
}
