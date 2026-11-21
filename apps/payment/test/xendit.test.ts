import { describe, expect, test } from "bun:test";
import { XENDIT_CHANNELS, toXenditItems } from "../src/providers/xendit.ts";

describe("XENDIT_CHANNELS", () => {
  test("maps PHP e-wallets and QR Ph to Xendit channel codes", () => {
    expect(XENDIT_CHANNELS.gcash).toBe("GCASH");
    expect(XENDIT_CHANNELS.maya).toBe("PAYMAYA");
    expect(XENDIT_CHANNELS.qrph).toBe("QRPH");
  });

  test("does not route cards through Xendit", () => {
    expect(XENDIT_CHANNELS.card).toBeNull();
  });
});

describe("toXenditItems", () => {
  test("maps line items to Xendit's basket shape", () => {
    const items = toXenditItems([
      { name: "Widget", amount: 5_000, quantity: 2 },
      { name: "Gadget", amount: 25_000, quantity: 1 },
    ]);

    expect(items).toEqual([
      {
        reference_id: "item_1",
        name: "Widget",
        type: "PHYSICAL_PRODUCT",
        category: "GENERAL",
        net_unit_amount: 5_000,
        quantity: 2,
      },
      {
        reference_id: "item_2",
        name: "Gadget",
        type: "PHYSICAL_PRODUCT",
        category: "GENERAL",
        net_unit_amount: 25_000,
        quantity: 1,
      },
    ]);
  });

  test("omits image_url when gRPC defaults the image to an empty string", () => {
    const items = toXenditItems([
      { name: "Widget", amount: 5_000, quantity: 1, image: "" },
    ]);

    expect(items[0]).not.toHaveProperty("image_url");
  });

  test("maps a real image url to image_url", () => {
    const items = toXenditItems([
      {
        name: "Widget",
        amount: 5_000,
        quantity: 1,
        image: "https://example.com/widget.png",
      },
    ]);

    expect(items[0]?.image_url).toBe("https://example.com/widget.png");
  });
});
