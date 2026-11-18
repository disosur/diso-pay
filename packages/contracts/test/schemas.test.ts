import { describe, expect, test } from "bun:test";
import { processPaymentSchema } from "../src/index.ts";

const base = {
  line_items: [{ name: "Item", amount: 50_000 }],
  success_url: "https://merchant.test/ok",
  cancel_url: "https://merchant.test/cancel",
};

describe("processPaymentSchema", () => {
  test("accepts a locked payment method", () => {
    const parsed = processPaymentSchema.parse({ ...base, payment_method: "gcash" });

    expect(parsed.payment_method).toBe("gcash");
  });

  test("leaves the method unlocked when it is omitted", () => {
    const parsed = processPaymentSchema.parse(base);

    expect(parsed.payment_method).toBeUndefined();
  });

  test("rejects an unsupported payment method", () => {
    const parsed = processPaymentSchema.safeParse({ ...base, payment_method: "paypal" });

    expect(parsed.success).toBe(false);
  });
});
