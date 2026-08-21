import type { Payment } from "@/lib/api/payments";

const METHOD_LABELS: Record<Payment["method"], string> = {
  UPI: "UPI",
  CARD: "Card",
  NETBANKING: "Netbanking",
  WALLET: "Wallet",
  EMI: "EMI",
  OTHER: "Other",
};

export function formatPaymentMethod(method: Payment["method"]): string {
  return METHOD_LABELS[method];
}
