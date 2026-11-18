import { Hono } from "hono";
import Stripe from "stripe";
import type { PaymentConfig } from "./config.ts";
import { log } from "./logger.ts";

const SIGNATURE_TOLERANCE_SECONDS = 300;

type PayrexEvent = {
  id?: string;
  type?: string;
  livemode?: boolean;
  data?: { resource?: Record<string, unknown> };
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

async function hmacSha256Hex(secret: string, payload: string): Promise<string> {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", key, encoder.encode(payload));

  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

function constantTimeEqual(left: string, right: string): boolean {
  if (left.length !== right.length) return false;

  let diff = 0;
  for (let index = 0; index < left.length; index += 1) {
    diff |= left.charCodeAt(index) ^ right.charCodeAt(index);
  }

  return diff === 0;
}

export type PayrexSignature = {
  timestamp: number;
  test: string;
  live: string;
};

export function parsePayrexSignature(header: string): PayrexSignature | null {
  const parts = new Map<string, string>();

  for (const segment of header.split(",")) {
    const separator = segment.indexOf("=");
    if (separator === -1) continue;

    parts.set(
      segment.slice(0, separator).trim(),
      segment.slice(separator + 1).trim(),
    );
  }

  const timestamp = Number(parts.get("t"));
  const test = parts.get("te");
  const live = parts.get("li");

  if (!Number.isFinite(timestamp) || timestamp <= 0) return null;
  if (!test && !live) return null;

  return { timestamp, test: test ?? "", live: live ?? "" };
}

export async function verifyPayrexSignature(input: {
  rawBody: string;
  header: string;
  secret: string;
  now?: number;
  toleranceSeconds?: number;
}): Promise<boolean> {
  const signature = parsePayrexSignature(input.header);
  if (!signature) return false;

  const now = input.now ?? Date.now();
  const tolerance = input.toleranceSeconds ?? SIGNATURE_TOLERANCE_SECONDS;

  if (Math.abs(now / 1000 - signature.timestamp) > tolerance) return false;

  const expected = await hmacSha256Hex(
    input.secret,
    `${signature.timestamp}.${input.rawBody}`,
  );

  return [signature.test, signature.live].some(
    (candidate) =>
      candidate.length > 0 && constantTimeEqual(candidate.toLowerCase(), expected),
  );
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

export function createWebhookRoutes(config: PaymentConfig): Hono {
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

    return c.json({ received: true });
  });

  app.post("/webhooks/payrex", async (c) => {
    const rawBody = await c.req.text();
    const signature = c.req.header("payrex-signature") ?? "";
    const payload = parseJson(rawBody);

    if (!isRecord(payload)) {
      log.warn("payrex webhook rejected", { code: "invalid_json" });
      return c.json({ error: "invalid_json" }, 400);
    }

    const event = payload as PayrexEvent;
    const summary = {
      provider: "payrex",
      event_id: event.id,
      type: event.type,
      livemode: event.livemode,
    };

    if (config.payrexWebhookSecret.length === 0) {
      log.warn("payrex webhook secret missing", { ...summary, verified: false });
      logWebhookPayload("payrex", false, payload);
      return c.json({ received: true, verified: false });
    }

    if (signature.length === 0) {
      log.warn("payrex webhook rejected", { ...summary, code: "missing_signature" });
      return c.json({ error: "missing_signature" }, 400);
    }

    const valid = await verifyPayrexSignature({
      rawBody,
      header: signature,
      secret: config.payrexWebhookSecret,
    });

    if (!valid) {
      log.warn("payrex webhook rejected", { ...summary, code: "invalid_signature" });
      return c.json({ error: "invalid_signature" }, 400);
    }

    log.info("payrex webhook received", {
      event_id: event.id,
      type: event.type,
      livemode: event.livemode,
      verified: true,
    });
    logWebhookPayload("payrex", true, payload);

    return c.json({ received: true });
  });

  return app;
}
