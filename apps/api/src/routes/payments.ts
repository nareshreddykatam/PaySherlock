import type { FastifyInstance } from "fastify";
import { z } from "zod";
import {
  getPaymentById,
  getPaymentByRazorpayId,
  listPayments,
  resolveMerchant,
  type Payment,
} from "@paysherlock/database";
import { NotFoundError, ValidationError } from "@paysherlock/types";
import type { ServerDeps } from "../server.js";

const ListPaymentsQuerySchema = z.object({
  limit: z.coerce.number().int().min(1).max(100).optional(),
  cursor: z.string().min(1).optional(),
});

/** Maps our internal Payment row to the API's normalized response shape —
 * deliberately not the raw Razorpay payload (`raw`, `notes`, `merchantId`
 * are internal-only). */
function toPaymentResponse(payment: Payment) {
  return {
    id: payment.id,
    razorpayPaymentId: payment.razorpayPaymentId,
    orderId: payment.orderId,
    amount: payment.amount,
    amountRefunded: payment.amountRefunded,
    currency: payment.currency,
    status: payment.status,
    method: payment.method,
    captured: payment.captured,
    international: payment.international,
    email: payment.email,
    contact: payment.contact,
    errorCode: payment.errorCode,
    errorDescription: payment.errorDescription,
    createdAt: payment.razorpayCreatedAt.toISOString(),
  };
}

export function registerPaymentRoutes(app: FastifyInstance, deps: ServerDeps): void {
  app.get("/payments", async (request) => {
    const query = ListPaymentsQuerySchema.safeParse(request.query);
    if (!query.success) {
      throw new ValidationError(
        query.error.issues.map((issue) => `${issue.path.join(".")}: ${issue.message}`).join("; "),
      );
    }

    // Merchant scoping is derived server-side, never from client input —
    // same trusted pattern as every other route. See docs/decisions.
    const merchant = await resolveMerchant(deps.db, {});
    const page = await listPayments(deps.db, {
      merchantId: merchant.id,
      limit: query.data.limit,
      cursor: query.data.cursor,
    });

    return {
      data: page.items.map(toPaymentResponse),
      nextCursor: page.nextCursor,
    };
  });

  app.get<{ Params: { id: string } }>("/payments/:id", async (request) => {
    const { id } = request.params;
    const merchant = await resolveMerchant(deps.db, {});
    const payment = id.startsWith("pay_")
      ? await getPaymentByRazorpayId(deps.db, id, merchant.id)
      : await getPaymentById(deps.db, id, merchant.id);

    if (!payment) {
      throw new NotFoundError(`Payment "${id}" was not found`);
    }
    return toPaymentResponse(payment);
  });
}
