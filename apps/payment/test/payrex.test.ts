import { describe, expect, test } from "bun:test";
import { encodeForm, toPayrexLineItems } from "../src/providers/payrex.ts";

describe("encodeForm", () => {
  test("encodes arrays with empty brackets, which is what PayRex parses", () => {
    const params = encodeForm({ payment_methods: ["maya"] });

    expect(params.toString()).toBe("payment_methods%5B%5D=maya");
    expect(params.getAll("payment_methods[]")).toEqual(["maya"]);
  });

  test("encodes nested line items without array indices", () => {
    const params = encodeForm({
      currency: "PHP",
      line_items: [
        { name: "Item 1", amount: 50_000, quantity: 1 },
        { name: "Item 2", amount: 25_000, quantity: 3 },
      ],
    });

    expect(params.getAll("line_items[][name]")).toEqual(["Item 1", "Item 2"]);
    expect(params.getAll("line_items[][amount]")).toEqual(["50000", "25000"]);
    expect(params.getAll("line_items[][quantity]")).toEqual(["1", "3"]);
    expect(params.get("currency")).toBe("PHP");
  });

  test("encodes nested maps as bracket keys", () => {
    const params = encodeForm({ metadata: { transaction_id: "txn_1" } });

    expect(params.get("metadata[transaction_id]")).toBe("txn_1");
  });

  test("skips undefined and null values", () => {
    const params = encodeForm({ a: 1, b: undefined, c: null });

    expect(params.toString()).toBe("a=1");
  });
});

describe("toPayrexLineItems", () => {
  test("omits image when gRPC defaults it to an empty string", () => {
    const items = toPayrexLineItems([
      { name: "Widget", amount: 5_000, quantity: 1, image: "" },
    ]);

    expect(items[0]).toEqual({ name: "Widget", amount: 5_000, quantity: 1 });
    expect("image" in items[0]!).toBe(false);
  });

  test("omits image when it is undefined", () => {
    const items = toPayrexLineItems([{ name: "Widget", amount: 5_000, quantity: 1 }]);

    expect(items[0]).toEqual({ name: "Widget", amount: 5_000, quantity: 1 });
  });

  test("keeps a real image url", () => {
    const items = toPayrexLineItems([
      {
        name: "Widget",
        amount: 5_000,
        quantity: 2,
        image: "https://example.com/widget.png",
      },
    ]);

    expect(items[0]).toEqual({
      name: "Widget",
      amount: 5_000,
      quantity: 2,
      image: "https://example.com/widget.png",
    });
  });
});
