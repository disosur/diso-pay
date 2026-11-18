import { convertLineItems, lineItemsTotal } from "./money.ts";
import type {
  Currency,
  LineItem,
  MethodOption,
  PaymentMethod,
  Provider,
} from "./types.ts";

export const METHOD_CATALOG: MethodOption[] = [
  {
    id: "card",
    label: "Card",
    provider: "stripe",
    php_only: false,
    description: "Visa, Mastercard, and other cards via Stripe.",
  },
  {
    id: "gcash",
    label: "GCash",
    provider: "payrex",
    php_only: true,
    description: "Pay with a GCash wallet.",
  },
  {
    id: "maya",
    label: "Maya",
    provider: "payrex",
    php_only: true,
    description: "Pay with a Maya account.",
  },
  {
    id: "qrph",
    label: "QR Ph",
    provider: "payrex",
    php_only: true,
    description: "Scan a QR Ph code with any participating bank app.",
  },
];

const CATALOG_BY_METHOD = new Map<PaymentMethod, MethodOption>(
  METHOD_CATALOG.map((option) => [option.id, option]),
);

export const MINIMUM_CHARGE: Record<Provider, Partial<Record<Currency, number>>> = {
  stripe: { USD: 50, PHP: 2000 },
  payrex: { PHP: 2000 },
};

export function providerForMethod(method: PaymentMethod): Provider {
  const option = CATALOG_BY_METHOD.get(method);
  if (!option) throw new Error(`unsupported_payment_method:${method}`);
  return option.provider;
}

export function isPaymentMethod(value: unknown): value is PaymentMethod {
  return typeof value === "string" && CATALOG_BY_METHOD.has(value as PaymentMethod);
}

export function isPhpOnlyMethod(method: PaymentMethod): boolean {
  return CATALOG_BY_METHOD.get(method)?.php_only ?? false;
}

export type ChargePlan = {
  provider: Provider;
  method: PaymentMethod;
  currency: Currency;
  amount: number;
  line_items: LineItem[];
};

export function planCharge(input: {
  method: PaymentMethod;
  currency: Currency;
  source_currency: Currency;
  line_items: LineItem[];
  phpPerUsd: number;
}): ChargePlan {
  const provider = providerForMethod(input.method);
  const currency = isPhpOnlyMethod(input.method) ? "PHP" : input.currency;
  const lineItems = convertLineItems(
    input.line_items,
    input.source_currency,
    currency,
    input.phpPerUsd,
  );

  return {
    provider,
    method: input.method,
    currency,
    amount: lineItemsTotal(lineItems),
    line_items: lineItems,
  };
}

export function validateChargePlan(plan: ChargePlan): string | null {
  if (plan.amount <= 0) return "amount_must_be_positive";

  const minimum = MINIMUM_CHARGE[plan.provider][plan.currency];
  if (minimum !== undefined && plan.amount < minimum) {
    return `amount_below_minimum:${plan.currency}:${minimum}`;
  }

  return null;
}
