// Monetary values throughout PaySherlock are represented as integer minor
// units (e.g. paise for INR), matching how Razorpay's API represents amounts.
// This avoids floating-point rounding errors entirely. Never store or compute
// money as a JS `number` with decimals — always integer minor units.
export type MinorUnitAmount = number;
