import type { LineItem, PaymentMethod } from "@diso-pay/contracts";
import { log } from "../logger.ts";
import type { CheckoutProvider, ProviderCheckoutInput } from "./types.ts";
import { ProviderError } from "./types.ts";

export const XENDIT_CHANNELS: Record<PaymentMethod, string | null> = {
  card: null,
  gcash: "GCASH",
  maya: "PAYMAYA",
  qrph: "QRPH",
};

type XenditSession = {
  payment_session_id?: string;
  payment_link_url?: string | null;
  expires_at?: string;
  status?: string;
  [key: string]: unknown;
};

export function toXenditItems(
  items: LineItem[],
): Array<Record<string, unknown>> {
  return items.map((item, index) => ({
    reference_id: `item_${index + 1}`,
    name: item.name,
    type: "PHYSICAL_PRODUCT",
    category: "GENERAL",
    net_unit_amount: item.amount,
    quantity: item.quantity,
    ...(item.image ? { image_url: item.image } : {}),
  }));
}

async function requestSession(
  secretKey: string,
  baseUrl: string,
  input: ProviderCheckoutInput,
) {
  const channel = XENDIT_CHANNELS[input.plan.method];
  if (!channel) {
    throw new ProviderError(
      "xendit",
      "invalid_request",
      "xendit_unsupported_method",
      input.plan.method,
    );
  }

  const expiresAt = input.transaction.expires_at;
  const expiresAtIso =
    expiresAt > Date.now() + 5 * 60 * 1000
      ? new Date(expiresAt).toISOString()
      : undefined;

  const body = JSON.stringify({
    reference_id: (input.transaction.reference || input.transaction.id).slice(
      0,
      64,
    ),
    session_type: "PAY",
    mode: "PAYMENT_LINK",
    amount: input.plan.amount,
    currency: input.plan.currency,
    country: "PH",
    allowed_payment_channels: [channel],
    description: input.transaction.description || undefined,
    success_return_url: input.success_url,
    cancel_return_url: input.cancel_url,
    expires_at: expiresAtIso,
    items: toXenditItems(input.plan.line_items),
    metadata: {
      transaction_id: input.transaction.id,
      ...input.transaction.metadata,
    },
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
      },
      body,
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new ProviderError(
      "xendit",
      "unavailable",
      timedOut ? "xendit_timeout" : "xendit_unreachable",
      error instanceof Error ? error.message : String(error),
    );
  }

  const text = await response.text();
  let parsed: unknown = null;
  try {
    parsed = text ? JSON.parse(text) : null;
  } catch {
    parsed = text;
  }

  if (!response.ok) {
    if (response.status === 401 || response.status === 403) {
      throw new ProviderError(
        "xendit",
        "authentication",
        "xendit_authentication_failed",
        typeof parsed === "string" ? parsed : JSON.stringify(parsed),
      );
    }

    if (response.status === 429) {
      throw new ProviderError(
        "xendit",
        "unavailable",
        "xendit_rate_limited",
        typeof parsed === "string" ? parsed : JSON.stringify(parsed),
      );
    }

    if (response.status >= 400 && response.status < 500) {
      throw new ProviderError(
        "xendit",
        "invalid_request",
        "xendit_request_invalid",
        typeof parsed === "string" ? parsed : JSON.stringify(parsed),
      );
    }

    throw new ProviderError(
      "xendit",
      "unavailable",
      "xendit_unavailable",
      `status_${response.status}`,
    );
  }

  const session = parsed as XenditSession | null;
  if (
    !session ||
    typeof session.payment_session_id !== "string" ||
    typeof session.payment_link_url !== "string"
  ) {
    throw new ProviderError("xendit", "unavailable", "xendit_invalid_response");
  }

  const responseExpires = session.expires_at
    ? Date.parse(session.expires_at)
    : NaN;

  return {
    provider_session_id: session.payment_session_id,
    url: session.payment_link_url,
    expires_at: Number.isFinite(responseExpires)
      ? responseExpires
      : input.transaction.expires_at,
  };
}

export function createXenditProvider(config: {
  secretKey: string;
  baseUrl: string;
}): CheckoutProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  return {
    id: "xendit",

    async createCheckoutSession(input: ProviderCheckoutInput) {
      if (!config.secretKey) {
        const error = new ProviderError(
          "xendit",
          "authentication",
          "xendit_secret_key_missing",
        );

        log.error("provider request failed", {
          provider: "xendit",
          kind: error.kind,
          message: error.message,
        });

        throw error;
      }

      log.debug("provider request", {
        provider: "xendit",
        currency: input.plan.currency,
        amount: input.plan.amount,
        line_items: input.plan.line_items.length,
        expires_at: input.transaction.expires_at,
      });

      try {
        const session = await requestSession(config.secretKey, baseUrl, input);

        log.info("provider request completed", {
          provider: "xendit",
          currency: input.plan.currency,
          amount: input.plan.amount,
          provider_session_id: session.provider_session_id,
        });

        return session;
      } catch (error) {
        if (error instanceof ProviderError) {
          log.error("provider request failed", {
            provider: "xendit",
            kind: error.kind,
            message: error.message,
          });
          throw error;
        }

        log.error("provider request failed", { provider: "xendit", err: error });
        throw error;
      }
    },
  };
}
