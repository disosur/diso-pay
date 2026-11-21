import { Hono } from "hono";
import Stripe from "stripe";
import {
  PAYMENT_SUCCEEDED,
  type LedgerClient,
  type PaymentSucceededPayload,
  type Provider,
} from "@diso-pay/contracts";
import type { PaymentConfig } from "./config.ts";
import { log } from "./logger.ts";

const SIGNATURE_TOLERANCE_SECONDS = 300;

const STRIPE_SUCCESS_EVENTS = new Set([
  "checkout.session.completed",
  "checkout.session.async_payment_succeeded",
]);

export type WebhookLedger = Pick<LedgerClient, "AppendEvent" | "FindActiveTransaction">;

type PaymentSignal = {
  transactionId?: string;
  reference?: string;
  providerSessionId?: string;
  amount?: number;
  currency?: string;
  eventId?: string;
};

type XenditEvent = {
  event?: string;
  business_id?: string;
  created?: string;
  data?: Record<string, unknown>;
};

type StripeEvent = {
  id?: string;
  type?: string;
  livemode?: boolean;
};

function parseJson(rawBody: string): unknown {
  try {
    return JSON.parse(rawBody);
  } catch {
    return null;
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function logWebhookPayload(provider: string, verified: boolean, payload: unknown): void {
  console.log(`--- ${provider} webhook (verified=${verified}) ---`);
  console.log(JSON.stringify(payload, null, 2));
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

function numberValue(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function stripeSuccessSignal(
  event: StripeEvent,
  payload: Record<string, unknown>,
): PaymentSignal | null {
  if (typeof event.type !== "string" || !STRIPE_SUCCESS_EVENTS.has(event.type)) {
    return null;
  }

  const data = isRecord(payload.data) ? payload.data : {};
  const object = isRecord(data.object) ? data.object : {};
  const metadata = isRecord(object.metadata) ? object.metadata : {};

  return {
    transactionId: stringValue(metadata.transaction_id),
    reference: stringValue(object.client_reference_id),
    providerSessionId: stringValue(object.id),
    amount: numberValue(object.amount_total),
    currency: stringValue(object.currency),
    eventId: event.id,
  };
}

function xenditSuccessSignal(
  event: XenditEvent,
  payload: Record<string, unknown>,
): PaymentSignal | null {
  if (event.event !== "payment_session.completed") return null;

  const data = isRecord(payload.data) ? payload.data : {};
  const metadata = isRecord(data.metadata) ? data.metadata : {};

  return {
    transactionId: stringValue(metadata.transaction_id),
    reference: stringValue(data.reference_id),
    providerSessionId: stringValue(data.payment_session_id),
    amount: numberValue(data.amount),
    currency: stringValue(data.currency),
  };
}

async function resolveTransactionId(
  ledger: WebhookLedger,
  signal: PaymentSignal,
): Promise<string | null> {
  if (signal.transactionId) return signal.transactionId;

  const reference = signal.reference;
  if (!reference) return null;

  if (reference.startsWith("txn_")) return reference;

  const response = await ledger.FindActiveTransaction({ reference });
  return response.transaction?.id ?? null;
}

async function recordPaymentSucceeded(
  ledger: WebhookLedger,
  provider: Provider,
  signal: PaymentSignal,
): Promise<"recorded" | "duplicate" | "not_found" | "failed"> {
  let transactionId: string | null;
  try {
    transactionId = await resolveTransactionId(ledger, signal);
  } catch (error) {
    log.error("payment transaction lookup failed", {
      provider,
      reference: signal.reference,
      err: error,
    });
    return "failed";
  }

  if (!transactionId) {
    log.warn("payment succeeded without matching transaction", {
      provider,
      provider_session_id: signal.providerSessionId,
      reference: signal.reference,
    });
    return "not_found";
  }

  const payload: PaymentSucceededPayload = {
    provider,
    provider_session_id: signal.providerSessionId ?? "",
    ...(signal.amount !== undefined ? { amount: signal.amount } : {}),
    ...(signal.currency
      ? { currency: signal.currency as PaymentSucceededPayload["currency"] }
      : {}),
    ...(signal.reference ? { reference: signal.reference } : {}),
    ...(signal.eventId ? { event_id: signal.eventId } : {}),
  };

  const dedupeKey =
    signal.providerSessionId ?? signal.eventId ?? transactionId;

  try {
    const result = await ledger.AppendEvent({
      transaction_id: transactionId,
      type: PAYMENT_SUCCEEDED,
      payload_json: JSON.stringify(payload),
      idempotency_key: `payment.succeeded:${provider}:${dedupeKey}`,
    });

    log.info("payment succeeded recorded", {
      provider,
      transaction_id: transactionId,
      provider_session_id: signal.providerSessionId,
      amount: signal.amount,
      currency: signal.currency,
      duplicate: result.duplicate,
    });

    return result.duplicate ? "duplicate" : "recorded";
  } catch (error) {
    log.error("payment succeeded append failed", {
      provider,
      transaction_id: transactionId,
      provider_session_id: signal.providerSessionId,
      err: error,
    });
    return "failed";
  }
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

let stripeVerifier: Stripe | undefined;

function stripeVerificationClient(secretKey: string): Stripe {
  if (!secretKey) {
    throw new Error("stripe_secret_key_missing");
  }

  stripeVerifier ??= new Stripe(secretKey, {
    maxNetworkRetries: 0,
    timeout: 15_000,
  });

  return stripeVerifier;
}

export async function verifyStripeSignature(input: {
  rawBody: string;
  header: string;
  secret: string;
  secretKey: string;
}): Promise<StripeEvent> {
  const client = stripeVerificationClient(input.secretKey);

  return client.webhooks.constructEventAsync(
    input.rawBody,
    input.header,
    input.secret,
    SIGNATURE_TOLERANCE_SECONDS,
  );
}

export function createWebhookRoutes(config: PaymentConfig, ledger: WebhookLedger): Hono {
  const app = new Hono();

  app.post("/webhooks/stripe", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("stripe-signature") ?? "";
    const payload = parseJson(rawBody);

    if (!isRecord(payload)) {
      log.warn("stripe webhook rejected", { code: "invalid_json" });
      return c.json({ error: "invalid_json" }, 400);
    }

    const summary = {
      provider: "stripe",
      event_id: typeof payload.id === "string" ? payload.id : undefined,
      type: typeof payload.type === "string" ? payload.type : undefined,
      livemode: typeof payload.livemode === "boolean" ? payload.livemode : undefined,
    };

    if (config.stripeWebhookSecret.length === 0) {
      log.warn("stripe webhook secret missing", { ...summary, verified: false });
      logWebhookPayload("stripe", false, payload);
      return c.json({ received: true, verified: false });
    }

    if (signature.length === 0) {
      log.warn("stripe webhook rejected", { ...summary, code: "missing_signature" });
      return c.json({ error: "missing_signature" }, 400);
    }

    let event: StripeEvent;
    try {
      event = await verifyStripeSignature({
        rawBody,
        header: signature,
        secret: config.stripeWebhookSecret,
        secretKey: config.stripeSecretKey,
      });
    } catch (error) {
      log.warn("stripe webhook rejected", {
        ...summary,
        code: "invalid_signature",
        err: error,
      });
      return c.json({ error: "invalid_signature" }, 400);
    }

    log.info("stripe webhook received", {
      event_id: event.id,
      type: event.type,
      livemode: event.livemode,
      verified: true,
    });
    logWebhookPayload("stripe", true, payload);

    const signal = stripeSuccessSignal(event, payload);
    if (signal) {
      const outcome = await recordPaymentSucceeded(ledger, "stripe", signal);
      if (outcome === "failed") {
        return c.json({ error: "ledger_append_failed" }, 502);
      }
    }

    return c.json({ received: true });
  });

  app.post("/webhooks/xendit", async (c) => {
    const rawBody = await c.req.text();
    const token = c.req.header("x-callback-token") ?? "";
    const payload = parseJson(rawBody);

    if (!isRecord(payload)) {
      log.warn("xendit webhook rejected", { code: "invalid_json" });
      return c.json({ error: "invalid_json" }, 400);
    }

    const event = payload as XenditEvent;
    const data = isRecord(event.data) ? event.data : {};
    const summary = {
      provider: "xendit",
      event: event.event,
      payment_session_id:
        typeof data.payment_session_id === "string"
          ? data.payment_session_id
          : undefined,
      status: typeof data.status === "string" ? data.status : undefined,
      reference_id:
        typeof data.reference_id === "string" ? data.reference_id : undefined,
    };

    if (config.xenditWebhookToken.length === 0) {
      log.warn("xendit webhook token missing", { ...summary, verified: false });
      logWebhookPayload("xendit", false, payload);
      return c.json({ received: true, verified: false });
    }

    if (token.length === 0) {
      log.warn("xendit webhook rejected", { ...summary, code: "missing_signature" });
      return c.json({ error: "missing_signature" }, 400);
    }

    if (!constantTimeEqual(token, config.xenditWebhookToken)) {
      log.warn("xendit webhook rejected", { ...summary, code: "invalid_signature" });
      return c.json({ error: "invalid_signature" }, 400);
    }

    log.info("xendit webhook received", {
      event: event.event,
      payment_session_id: summary.payment_session_id,
      status: summary.status,
      reference_id: summary.reference_id,
      verified: true,
    });
    logWebhookPayload("xendit", true, payload);

    const signal = xenditSuccessSignal(event, payload);
    if (signal) {
      const outcome = await recordPaymentSucceeded(ledger, "xendit", signal);
      if (outcome === "failed") {
        return c.json({ error: "ledger_append_failed" }, 502);
      }
    }

    return c.json({ received: true });
  });

  return app;
}
