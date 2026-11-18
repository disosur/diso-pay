import type { Currency, LineItem } from "./types.ts";

export const DEFAULT_PHP_PER_USD = 58;

export function convertMinor(
  amount: number,
  from: Currency,
  to: Currency,
  phpPerUsd: number,
): number {
  if (from === to) return amount;
  if (!Number.isFinite(phpPerUsd) || phpPerUsd <= 0) {
    throw new Error("invalid_fx_rate");
  }

  return from === "PHP"
    ? Math.round(amount / phpPerUsd)
    : Math.round(amount * phpPerUsd);
}

export function convertLineItems(
  items: LineItem[],
  from: Currency,
  to: Currency,
  phpPerUsd: number,
): LineItem[] {
  if (from === to) return items.map((item) => ({ ...item }));

  return items.map((item) => ({
    ...item,
    amount: convertMinor(item.amount, from, to, phpPerUsd),
  }));
}

export function lineItemsTotal(items: LineItem[]): number {
  return items.reduce(
    (total, item) => total + item.amount * item.quantity,
    0,
  );
}

export function formatAmount(amount: number, currency: Currency): string {
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
    minimumFractionDigits: 2,
  }).format(amount / 100);
}
