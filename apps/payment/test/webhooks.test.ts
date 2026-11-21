import { afterEach, describe, expect, spyOn, test } from "bun:test";
import Stripe from "stripe";
import type {
  AppendEventRequest,
  Transaction,
} from "@diso-pay/contracts";
import type { PaymentConfig } from "../src/config.ts";
import { createWebhookRoutes, type WebhookLedger } from "../src/webhooks.ts";

function config(overrides: Partial<PaymentConfig> = {}): PaymentConfig {
  return {
    httpPort: 0,
    grpcAddress: "127.0.0.1:0",
    ledgerAddress: "127.0.0.1:0",
    processorPublicUrl: "http://localhost:3000",
    checkoutReturnBaseUrl: "",
    fxPhpPerUsd: 58,
    fxStripeLockDuration: "hour",
    transactionTtlSeconds: 1_800,
    stripeSecretKey: "sk_test_webhook",
    stripeWebhookSecret: "whsec_test",
    stripeApiBaseUrl: "https://api.stripe.com",
    xenditSecretKey: "xnd_development_test",
    xenditWebhookToken: "xnd_callback_token",
    xenditApiBaseUrl: "https://api.xendit.co",
    ...overrides,
  };
}

function transaction(id: string): Transaction {
  return {
    id,
    status: "awaiting_payment",
    currency: "PHP",
    amount_total: 50_000,
    line_items: [{ name: "Item", amount: 50_000, quantity: 1 }],
    success_url: "https://merchant.test/ok",
    cancel_url: "https://merchant.test/cancel",
    reference: "order_0001",
    description: "",
    customer_email: "",
    payment_method: "gcash",
    metadata: {},
    sessions: [],
    created_at: 0,
    expires_at: Date.now() + 60_000,
    updated_at: 0,
    last_outcome: "",
  };
}

function ledgerStub(overrides: Partial<WebhookLedger> = {}): {
  ledger: WebhookLedger;
  appends: AppendEventRequest[];
} {
  const appends: AppendEventRequest[] = [];

  const ledger: WebhookLedger = {
    AppendEvent: async (request) => {
      appends.push(request);
      return {
        event: {
          id: appends.length,
          transaction_id: request.transaction_id,
          sequence: appends.length,
          type: request.type,
          payload_json: request.payload_json,
          idempotency_key: request.idempotency_key,
          created_at: Date.now(),
        },
        duplicate: false,
      };
    },
    FindActiveTransaction: async () => ({ transaction: null }),
    ...overrides,
  };

  return { ledger, appends };
}

const xenditBody = JSON.stringify({
  event: "payment_session.completed",
  business_id: "661f87c614802d6c402cd82d",
  created: "2026-12-31T23:59:59Z",
  data: {
    payment_session_id: "ps-661f87c614802d6c402cd82d",
    reference_id: "order_0001",
    status: "COMPLETED",
    amount: 50_000,
    currency: "PHP",
    metadata: { transaction_id: "txn_xendit_1" },
  },
});

const stripeBody = JSON.stringify({
  id: "evt_stripe_1",
  object: "event",
  type: "checkout.session.completed",
  livemode: false,
  data: {
    object: {
      id: "cs_test_1",
      object: "checkout.session",
      metadata: { transaction_id: "txn_stripe_1" },
      amount_total: 50_000,
      currency: "php",
      payment_status: "paid",
    },
  },
});

let consoleSpy: ReturnType<typeof spyOn> | undefined;

afterEach(() => {
  consoleSpy?.mockRestore();
  consoleSpy = undefined;
});

function silenceConsole(): void {
  consoleSpy = spyOn(console, "log").mockImplementation(() => {});
}

async function stripeSignature(body: string): Promise<string> {
  return new Stripe("sk_test_webhook").webhooks.generateTestHeaderStringAsync({
    payload: body,
    secret: "whsec_test",
  });
}

describe("webhook routes", () => {
  test("logs a verified Xendit event", async () => {
    silenceConsole();
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
      headers: { "x-callback-token": "xnd_callback_token" },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  test("records a completed Xendit payment", async () => {
    silenceConsole();
    const { ledger, appends } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
      headers: { "x-callback-token": "xnd_callback_token" },
    });

    expect(response.status).toBe(200);
    expect(appends).toHaveLength(1);
    expect(appends[0]).toMatchObject({
      transaction_id: "txn_xendit_1",
      type: "payment.succeeded",
      idempotency_key: "payment.succeeded:xendit:ps-661f87c614802d6c402cd82d",
    });
    expect(JSON.parse(appends[0]!.payload_json)).toEqual({
      provider: "xendit",
      provider_session_id: "ps-661f87c614802d6c402cd82d",
      amount: 50_000,
      currency: "PHP",
      reference: "order_0001",
    });
  });

  test("resolves an Xendit transaction from a merchant reference", async () => {
    silenceConsole();
    const { ledger, appends } = ledgerStub({
      FindActiveTransaction: async () => ({
        transaction: transaction("txn_resolved_1"),
      }),
    });
    const app = createWebhookRoutes(config(), ledger);
    const body = JSON.stringify({
      event: "payment_session.completed",
      data: {
        payment_session_id: "ps_reference",
        reference_id: "order_0001",
        status: "COMPLETED",
      },
    });

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body,
      headers: { "x-callback-token": "xnd_callback_token" },
    });

    expect(response.status).toBe(200);
    expect(appends).toHaveLength(1);
    expect(appends[0]?.transaction_id).toBe("txn_resolved_1");
  });

  test("records a completed Stripe payment", async () => {
    silenceConsole();
    const { ledger, appends } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);
    const signature = await stripeSignature(stripeBody);

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      body: stripeBody,
      headers: { "stripe-signature": signature },
    });

    expect(response.status).toBe(200);
    expect(appends).toHaveLength(1);
    expect(appends[0]).toMatchObject({
      transaction_id: "txn_stripe_1",
      type: "payment.succeeded",
      idempotency_key: "payment.succeeded:stripe:cs_test_1",
    });
    expect(JSON.parse(appends[0]!.payload_json)).toEqual({
      provider: "stripe",
      provider_session_id: "cs_test_1",
      amount: 50_000,
      currency: "php",
      event_id: "evt_stripe_1",
    });
  });

  test("does not record a non-success Stripe event", async () => {
    silenceConsole();
    const { ledger, appends } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);
    const body = JSON.stringify({
      id: "evt_stripe_2",
      type: "checkout.session.expired",
      data: { object: { id: "cs_test_2", object: "checkout.session" } },
    });
    const signature = await stripeSignature(body);

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      body,
      headers: { "stripe-signature": signature },
    });

    expect(response.status).toBe(200);
    expect(appends).toHaveLength(0);
  });

  test("does not record an unverified event", async () => {
    silenceConsole();
    const { ledger, appends } = ledgerStub();
    const app = createWebhookRoutes(config({ xenditWebhookToken: "" }), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, verified: false });
    expect(appends).toHaveLength(0);
  });

  test("returns 502 when the ledger append fails", async () => {
    silenceConsole();
    const { ledger } = ledgerStub({
      AppendEvent: async () => {
        throw new Error("ledger_unavailable");
      },
    });
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
      headers: { "x-callback-token": "xnd_callback_token" },
    });

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({ error: "ledger_append_failed" });
  });

  test("rejects an Xendit event with a bad callback token", async () => {
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
      headers: { "x-callback-token": "wrong_token" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  test("rejects an Xendit event with a missing callback token", async () => {
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "missing_signature" });
  });

  test("logs an unverified Xendit event when no token is configured", async () => {
    silenceConsole();
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config({ xenditWebhookToken: "" }), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: xenditBody,
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true, verified: false });
  });

  test("logs a verified Stripe event", async () => {
    silenceConsole();
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);
    const signature = await stripeSignature(stripeBody);

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      body: stripeBody,
      headers: { "stripe-signature": signature },
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({ received: true });
  });

  test("rejects a Stripe event with a bad signature", async () => {
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/stripe", {
      method: "POST",
      body: stripeBody,
      headers: { "stripe-signature": "t=1,v1=deadbeef" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_signature" });
  });

  test("rejects a webhook body that is not JSON", async () => {
    const { ledger } = ledgerStub();
    const app = createWebhookRoutes(config(), ledger);

    const response = await app.request("/webhooks/xendit", {
      method: "POST",
      body: "not-json",
      headers: { "x-callback-token": "xnd_callback_token" },
    });

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({ error: "invalid_json" });
  });
});
