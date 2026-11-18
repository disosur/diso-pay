import { describe, expect, test } from "bun:test";
import {
  convertMinor,
  lineItemsTotal,
  planCharge,
  validateChargePlan,
  type LineItem,
} from "../src/index.ts";

describe("convertMinor", () => {
  test("converts between PHP and USD minor units", () => {
    expect(convertMinor(5_800, "PHP", "USD", 58)).toBe(100);
    expect(convertMinor(100, "USD", "PHP", 58)).toBe(5_800);
    expect(convertMinor(5_800, "PHP", "PHP", 58)).toBe(5_800);
  });

  test("rejects invalid rates", () => {
    expect(() => convertMinor(100, "PHP", "USD", 0)).toThrow("invalid_fx_rate");
  });
});

describe("planCharge", () => {
  test("routes cards to Stripe and converts when the currency changes", () => {
    const plan = planCharge({
      method: "card",
      currency: "USD",
      source_currency: "PHP",
      line_items: [{ name: "Item", amount: 5_800, quantity: 1 }],
      phpPerUsd: 58,
    });

    expect(plan.provider).toBe("stripe");
    expect(plan.currency).toBe("USD");
    expect(plan.amount).toBe(100);
    expect(plan.line_items[0]?.amount).toBe(100);
  });

  test("keeps card charges in the transaction currency when it matches", () => {
    const plan = planCharge({
      method: "card",
      currency: "PHP",
      source_currency: "PHP",
      line_items: [{ name: "Item", amount: 50_000, quantity: 1 }],
      phpPerUsd: 58,
    });

    expect(plan.provider).toBe("stripe");
    expect(plan.amount).toBe(50_000);
  });

  test("forces PHP wallets onto PayRex in PHP", () => {
    for (const method of ["gcash", "maya", "qrph"] as const) {
      const plan = planCharge({
        method,
        currency: "USD",
        source_currency: "USD",
        line_items: [{ name: "Item", amount: 1_000, quantity: 2 }],
        phpPerUsd: 58,
      });

      expect(plan.provider).toBe("payrex");
      expect(plan.currency).toBe("PHP");
      expect(plan.amount).toBe(116_000);
    }
  });

  test("keeps totals consistent with converted line items", () => {
    const plan = planCharge({
      method: "maya",
      currency: "PHP",
      source_currency: "USD",
      line_items: [{ name: "A", amount: 333, quantity: 3 }],
      phpPerUsd: 58,
    });

    expect(plan.amount).toBe(lineItemsTotal(plan.line_items));
  });
});

describe("validateChargePlan", () => {
  test("enforces PayRex's PHP minimum", () => {
    const plan = planCharge({
      method: "gcash",
      currency: "PHP",
      source_currency: "PHP",
      line_items: [{ name: "Item", amount: 1_000, quantity: 1 }],
      phpPerUsd: 58,
    });

    expect(validateChargePlan(plan)).toBe("amount_below_minimum:PHP:2000");
  });

  test("accepts valid amounts", () => {
    const plan = planCharge({
      method: "card",
      currency: "USD",
      source_currency: "USD",
      line_items: [{ name: "Item", amount: 500, quantity: 1 }],
      phpPerUsd: 58,
    });

    expect(validateChargePlan(plan)).toBeNull();
  });
});
