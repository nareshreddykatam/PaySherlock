// Realistic Razorpay Test Mode-shaped webhook payloads for unit tests.
// These are synthetic fixtures — no real customer or production data.

export const paymentCapturedPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "payment.captured",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_test0000000001",
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "captured",
        order_id: "order_test0000000001",
        method: "upi",
        captured: true,
        international: false,
        email: "test.customer@example.com",
        contact: "+919999999999",
        error_code: null,
        error_description: null,
        notes: {},
        created_at: 1767000000,
      },
    },
  },
  created_at: 1767000006,
};

export const paymentFailedPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "payment.failed",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_test0000000002",
        entity: "payment",
        amount: 75000,
        currency: "INR",
        status: "failed",
        order_id: "order_test0000000002",
        method: "netbanking",
        captured: false,
        international: false,
        email: "test.customer@example.com",
        contact: "+919999999999",
        error_code: "BAD_REQUEST_ERROR",
        error_description: "Payment failed due to insufficient funds.",
        notes: {},
        created_at: 1767000100,
      },
    },
  },
  created_at: 1767000101,
};

export const orderPaidPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "order.paid",
  contains: ["order", "payment"],
  payload: {
    order: {
      entity: {
        id: "order_test0000000001",
        entity: "order",
        amount: 50000,
        amount_paid: 50000,
        amount_due: 0,
        currency: "INR",
        receipt: "receipt#1",
        status: "paid",
        attempts: 1,
        notes: {},
        created_at: 1766999990,
      },
    },
    payment: {
      entity: {
        id: "pay_test0000000001",
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "captured",
        order_id: "order_test0000000001",
        method: "upi",
        captured: true,
        international: false,
        email: "test.customer@example.com",
        contact: "+919999999999",
        error_code: null,
        error_description: null,
        notes: {},
        created_at: 1767000000,
      },
    },
  },
  created_at: 1767000007,
};

export const refundProcessedPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "refund.processed",
  contains: ["refund", "payment"],
  payload: {
    refund: {
      entity: {
        id: "rfnd_test0000000001",
        entity: "refund",
        amount: 50000,
        currency: "INR",
        payment_id: "pay_test0000000001",
        notes: { reason: "customer requested" },
        receipt: null,
        created_at: 1767010000,
        status: "processed",
        speed_processed: "normal",
        speed_requested: "optimum",
      },
    },
    payment: {
      entity: {
        id: "pay_test0000000001",
        entity: "payment",
        amount: 50000,
        currency: "INR",
        status: "refunded",
        order_id: "order_test0000000001",
        method: "upi",
        captured: true,
        international: false,
        email: "test.customer@example.com",
        contact: "+919999999999",
        error_code: null,
        error_description: null,
        amount_refunded: 50000,
        notes: {},
        created_at: 1767000000,
      },
    },
  },
  created_at: 1767010001,
};

export const refundFailedPayload = {
  ...refundProcessedPayload,
  event: "refund.failed",
  payload: {
    ...refundProcessedPayload.payload,
    refund: {
      entity: {
        ...refundProcessedPayload.payload.refund.entity,
        status: "failed",
      },
    },
  },
};

/** An event type PaySherlock does not (yet) act on — used to test graceful
 * "unsupported event" handling. */
export const paymentAuthorizedPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "payment.authorized",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_test0000000003",
        entity: "payment",
        amount: 20000,
        currency: "INR",
        status: "authorized",
        order_id: "order_test0000000003",
        method: "card",
        captured: false,
        created_at: 1767000200,
      },
    },
  },
  created_at: 1767000201,
};

export const malformedPayload = {
  entity: "event",
  event: "payment.captured",
  // `contains`/`payload` deliberately missing/malformed.
  payload: { payment: { entity: { foo: "bar" } } },
};

// The real shape confirmed against a live Razorpay Test Mode webhook
// delivery: `notes` arrives as an empty array, not `{}` or `null`, when no
// notes are attached. Distinct from `malformedPayload` above (which is
// missing required fields entirely) — this payload is otherwise complete
// and valid.
export const orderPaidArrayNotesPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "order.paid",
  contains: ["payment", "order"],
  payload: {
    payment: {
      entity: {
        id: "pay_test0000000010",
        entity: "payment",
        amount: 10000,
        currency: "INR",
        status: "captured",
        order_id: "order_test0000000010",
        international: false,
        method: "card",
        amount_refunded: 0,
        refund_status: null,
        captured: true,
        description: "#test",
        card_id: "card_test0000000010",
        bank: null,
        wallet: null,
        vpa: null,
        email: "void@razorpay.com",
        contact: "+919999999999",
        notes: [],
        fee: 220,
        tax: 0,
        error_code: null,
        error_description: null,
        error_source: null,
        error_step: null,
        error_reason: null,
        created_at: 1767461836,
      },
    },
    order: {
      entity: {
        id: "order_test0000000010",
        entity: "order",
        amount: 10000,
        amount_paid: 10000,
        amount_due: 0,
        currency: "INR",
        receipt: null,
        offer_id: null,
        status: "paid",
        attempts: 1,
        notes: [],
        created_at: 1767461802,
      },
    },
  },
  created_at: 1767462096,
};

/** A payment entity that fails schema validation for a reason unrelated to
 * `notes` — an invalid `status` enum value — used to confirm the fix only
 * widens acceptance of the real-world `notes` shape, not validation in
 * general. */
export const paymentCapturedInvalidStatusPayload = {
  entity: "event",
  account_id: "acc_test000000000000",
  event: "payment.captured",
  contains: ["payment"],
  payload: {
    payment: {
      entity: {
        id: "pay_test0000000011",
        entity: "payment",
        amount: 10000,
        currency: "INR",
        status: "not_a_real_status",
        order_id: "order_test0000000011",
        method: "card",
        captured: true,
        notes: {},
        created_at: 1767462000,
      },
    },
  },
  created_at: 1767462001,
};
