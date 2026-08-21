import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { PaymentsTable } from "@/components/payments/PaymentsTable";
import type { Payment } from "@/lib/api/payments";

const payments: Payment[] = [
  {
    id: "internal-1",
    razorpayPaymentId: "pay_test0000000001",
    orderId: "order_test0000000001",
    amount: 240_000,
    amountRefunded: 0,
    currency: "INR",
    status: "CAPTURED",
    method: "UPI",
    captured: true,
    international: false,
    email: null,
    contact: null,
    errorCode: null,
    errorDescription: null,
    createdAt: "2026-08-20T14:32:00.000Z",
  },
  {
    id: "internal-2",
    razorpayPaymentId: "pay_test0000000002",
    orderId: null,
    amount: 820_000,
    amountRefunded: 0,
    currency: "INR",
    status: "FAILED",
    method: "CARD",
    captured: false,
    international: false,
    email: null,
    contact: null,
    errorCode: "BAD_REQUEST_ERROR",
    errorDescription: "Payment failed",
    createdAt: "2026-08-20T14:29:00.000Z",
  },
];

describe("PaymentsTable", () => {
  it("renders every row's status, method, amount, and Razorpay id", () => {
    render(<PaymentsTable payments={payments} />);

    expect(screen.getByText("Captured")).toBeInTheDocument();
    expect(screen.getByText("Failed")).toBeInTheDocument();
    expect(screen.getByText("UPI")).toBeInTheDocument();
    expect(screen.getByText("Card")).toBeInTheDocument();
    expect(screen.getByText("₹2,400")).toBeInTheDocument();
    expect(screen.getByText("₹8,200")).toBeInTheDocument();
    expect(screen.getByText("pay_test0000000001")).toBeInTheDocument();
  });

  it("exposes each row as a keyboard-accessible control with a descriptive name", () => {
    render(<PaymentsTable payments={payments} />);

    const row = screen.getByRole("button", {
      name: "View details for payment pay_test0000000001",
    });
    expect(row).toHaveAttribute("tabIndex", "0");
  });
});
