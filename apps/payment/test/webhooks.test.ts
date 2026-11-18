import { afterEach, describe, expect, spyOn, test } from "bun:test";
import Stripe from "stripe";
import type { PaymentConfig } from "../src/config.ts";
import {
  createWebhookRoutes,
  parsePayrexSignature,
  verifyPayrexSignature,
} from "../src/webhooks.ts";

const NOW = 1_900_000_000_000;

function config(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    httpPort: 0,
    grpcAddress: "127.0.0.1:0",
    ledgerAddress: "127.0.0.1:0",
    processorPublicUrl: "http://localhost:3000",
    checkoutReturnBaseUrl: "",
    fxPhpPerUsd: 58,
    transactionTtlSeconds: 1_800,
    stripeSecretKey: "sk_test_webhook",
    stripeWebhookSecret: "whsec_test",
    payrexSecretKey: "sk_test",
    payrexWebhookSecret: "whsk_test",
    payrexApiBaseUrl: "https://api.payrexhq.com",
    ...overrides,
  };
}

async function payrexSignature(
  rawBody: string,
  secret: string,
  timestamp: number,
): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(`${timestamp}.${rawBody}`),
  );
  const hex = [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");

  return `t=${timestamp},te=${hex},li=`;
}

const payrexBody = JSON.stringify({
  id: "evt_payrex_1",
  type: "payment_intent.succeeded",
  livemode: false,
  data: { resource: { id: "pi_1", amount: 50_000, currency: "PHP" } },
});

const stripeBody = JSON.stringify({
  id: "evt_stripe_1",
  object: "event",
  type: "checkout.session.completed",
  livemode: false,
  data: { object: { id: "cs_test_1", object: "checkout.session" } },
});

let consoleSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  consoleSpy?.mockRestore();
  consoleSpy = undefined;
});

function silenceConsole(): void {
  consoleSpy = spyOn(console, "log").mockImplementation(() => {});
}

describe("verifyPayrexSignature", () => {
  test("accepts a signature over the timestamp and raw body", async () => {
    const header = await payrexSignature(payrexBody, "whsk_test", NOW / 1000);

    expect(parsePayrexSignature(header)).toMatchObject({ timestamp: NOW / 1000 });
    expect(
      await verifyPayrexSignature({
        rawBody: payrexBody,
        header,
        secret: "whsk_test",
        now: NOW,
      }),
    ).toBe(true);
  });

  test("rejects a tampered body", async () => {
    const header = await payrexSignature(payrexBody, "whsk_test", NOW / 1000);

    expect(
      await verifyPayrexSignature({
        rawBody: `${payrexBody} `,
        header,
        secret: "whsk_test",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("rejects a timestamp outside the tolerance", async () => {
    const header = await payrexSignature(
      payrexBody,
      "whsk_test",
      NOW / 1000 - 600,
    );

    expect(
      await verifyPayrexSignature({
        rawBody: payrexBody,
        header,
        secret: "whsk_test",
        now: NOW,
      }),
    ).toBe(false);
  });

  test("rejects a malformed header", () => {
    expect(parsePayrexSignature("t=abc,te=,li=")).toBeNull();
    expect(parsePayrexSignature("garbage")).toBeNull();
  });
});

describe("webhook routes", () => {
  test("logs a verified PayRex event", async () => {
    silenceConsole();
    const app = createWebhookRoutes(config());
    const header = await payrexSignature(
      payrexBody,
      "whsk_test",
      Math.floor(Date.now() / 1000),
    );

    const response = await app.request("/webhooks/payrex", {
      method: "POST",
      body: payrexBody,
      headers: { "payrex-signature": header },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  test("rejects a PayRex event with a bad signature", async () => {
    const app = createWebhookRoutes(config());

    const response = await app.request("/webhooks/payrex", {
      method: "POST",
      body: payrexBody,
      headers: { "payrex-signature": "t=1,te=deadbeef,li=" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  test("logs an unverified PayRex event when no secret is configured", async () => {
    silenceConsole();
    const app = createWebhookRoutes(config({ payrexWebhookSecret: "" }));

    const response = await app.request("/webhooks/payrex", {
      method: "POST",
      body: payrexBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, verified: false });
  });

  test("logs a verified Stripe event", async () => {
    silenceConsole();
    const app = createWebhookRoutes(config());
    const signature = await new Stripe(
      "sk_test_webhook",
    ).webhooks.generateTestHeaderStringAsync({
      payload: stripeBody,
      secret: "whsec_test",
    });

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      body: stripeBody,
      headers: { "stripe-signature": signature },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  test("rejects a Stripe event with a bad signature", async () => {
    const app = createWebhookRoutes(config());

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      body: stripeBody,
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  test("rejects a webhook body that is not JSON", async () => {
    const app = createWebhookRoutes(config());

    const response = await app.request("/webhooks/payrex", {
      method: "POST",
      body: "not-json",
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
  });
});
