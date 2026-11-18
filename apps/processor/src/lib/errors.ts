const MESSAGES: Array<[string, string]> = [
  ["transaction_not_found", "We could not find this payment link."],
  ["transaction_not_active", "This payment link has expired. Ask the merchant for a new one."],
  ["transaction_expired", "This payment link has expired. Ask the merchant for a new one."],
  ["transaction_already_completed", "This payment has already been completed."],
  ["amount_below_minimum", "The amount is below the minimum for this payment method."],
  ["amount_must_be_positive", "The amount must be greater than zero."],
  ["unsupported_currency", "This currency is not supported for the selected payment method."],
  ["unsupported_payment_method", "This payment method is not supported."],
  ["payment_method_not_allowed", "This payment link is locked to a different payment method."],
  ["invalid_transaction_id", "This payment link is malformed."],
  ["expires_at_in_the_past", "The requested expiry is in the past."],
  ["expires_at_too_far_in_the_future", "The requested expiry is too far in the future."],
  ["provider_authentication_failed", "The payment provider is misconfigured. Contact the merchant."],
  ["ledger_unavailable", "The payment service is temporarily unavailable. Try again shortly."],
  ["ledger_timeout", "The payment service timed out. Try again shortly."],
];

export function describeCheckoutError(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const code = raw.split(":")[0]?.trim() ?? "";

  for (const [prefix, message] of MESSAGES) {
    if (code === prefix) return message;
  }

  if (code.startsWith("stripe_") || code.startsWith("payrex_")) {
    if (code.includes("unavailable") || code.includes("unreachable")) {
      return "The payment provider is temporarily unavailable. Try again shortly.";
    }

    return "The payment provider rejected this request.";
  }

  if (code === "UNAVAILABLE" || code === "14" || raw.includes("UNAVAILABLE")) {
    return "The payment service is temporarily unavailable. Try again shortly.";
  }

  return "Something went wrong while starting the payment. Please try again.";
}
