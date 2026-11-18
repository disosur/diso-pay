import type { LineItem } from "@diso-pay/contracts";
import { log } from "../logger.ts";
import type { CheckoutProvider, ProviderCheckoutInput } from "./types.ts";
import { ProviderError } from "./types.ts";

type PayrexCheckoutSession = {
  id: string;
  url: string;
  status: string;
  expires_at?: number;
  [key: string]: unknown;
};

export function encodeForm(payload: unknown, prefix = "", params = new URLSearchParams()) {
  if (payload === undefined || payload === null) return params;

  if (Array.isArray(payload)) {
    payload.forEach((value) => {
      encodeForm(value, `${prefix}[]`, params);
    });
    return params;
  }

  if (typeof payload === "object") {
    for (const [key, value] of Object.entries(payload)) {
      encodeForm(value, prefix ? `${prefix}[${key}]` : key, params);
    }
    return params;
  }

  params.append(prefix, String(payload));
  return params;
}

export function toPayrexLineItems(
  items: LineItem[],
): Array<Record<string, unknown>> {
  return items.map((item) => ({
    name: item.name,
    amount: item.amount,
    quantity: item.quantity,
    ...(item.image ? { image: item.image } : {}),
  }));
}

async function requestSession(
  secretKey: string,
  baseUrl: string,
  input: ProviderCheckoutInput,
) {
  const expiresAtSeconds = Math.floor(input.transaction.expires_at / 1000);
  const body = encodeForm({
    currency: input.plan.currency,
    success_url: input.success_url,
    cancel_url: input.cancel_url,
    payment_methods: [input.plan.method],
    customer_reference_id:
      input.transaction.reference || input.transaction.id,
    description: input.transaction.description || undefined,
    metadata: {
      transaction_id: input.transaction.id,
      ...input.transaction.metadata,
    },
    expires_at:
      expiresAtSeconds > Math.floor(Date.now() / 1000) + 300
        ? expiresAtSeconds
        : undefined,
    line_items: toPayrexLineItems(input.plan.line_items),
  });

  let response: Response;
  try {
    response = await fetch(`${baseUrl}/checkout_sessions`, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Authorization: `Basic ${btoa(`${secretKey}:`)}`,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(15_000),
    });
  } catch (error) {
    const timedOut = error instanceof DOMException && error.name === "TimeoutError";
    throw new ProviderError(
      "payrex",
      "unavailable",
      timedOut ? "payrex_timeout" : "payrex_unreachable",
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
    if (response.status === 401) {
      throw new ProviderError(
        "payrex",
        "authentication",
        "payrex_authentication_failed",
        typeof parsed === "string" ? parsed : JSON.stringify(parsed),
      );
    }

    if (response.status === 403) {
      if (parsed !== null && typeof parsed === "object") {
        throw new ProviderError(
          "payrex",
          "authentication",
          "payrex_authentication_failed",
          JSON.stringify(parsed),
        );
      }

      throw new ProviderError(
        "payrex",
        "invalid_request",
        "payrex_request_blocked",
        typeof parsed === "string" ? parsed.slice(0, 200) : "payrex_rejected_request",
      );
    }

    if (response.status >= 400 && response.status < 500) {
      throw new ProviderError(
        "payrex",
        "invalid_request",
        "payrex_request_invalid",
        typeof parsed === "string" ? parsed : JSON.stringify(parsed),
      );
    }

    throw new ProviderError(
      "payrex",
      "unavailable",
      "payrex_unavailable",
      `status_${response.status}`,
    );
  }

  const session = parsed as PayrexCheckoutSession | null;
  if (!session || typeof session.id !== "string" || typeof session.url !== "string") {
    throw new ProviderError("payrex", "unavailable", "payrex_invalid_response");
  }

  return {
    provider_session_id: session.id,
    url: session.url,
    expires_at:
      typeof session.expires_at === "number"
        ? session.expires_at * 1000
        : input.transaction.expires_at,
  };
}

export function createPayrexProvider(config: {
  secretKey: string;
  baseUrl: string;
}): CheckoutProvider {
  const baseUrl = config.baseUrl.replace(/\/+$/, "");

  return {
    id: "payrex",

    async createCheckoutSession(input: ProviderCheckoutInput) {
      if (!config.secretKey) {
        const error = new ProviderError(
          "payrex",
          "authentication",
          "payrex_secret_key_missing",
        );

        log.error("provider request failed", {
          provider: "payrex",
          kind: error.kind,
          message: error.message,
        });

        throw error;
      }

      log.debug("provider request", {
        provider: "payrex",
        currency: input.plan.currency,
        amount: input.plan.amount,
        line_items: input.plan.line_items.length,
        expires_at: input.transaction.expires_at,
      });

      try {
        const session = await requestSession(config.secretKey, baseUrl, input);

        log.info("provider request completed", {
          provider: "payrex",
          currency: input.plan.currency,
          amount: input.plan.amount,
          provider_session_id: session.provider_session_id,
        });

        return session;
      } catch (error) {
        if (error instanceof ProviderError) {
          log.error("provider request failed", {
            provider: "payrex",
            kind: error.kind,
            message: error.message,
          });
          throw error;
        }

        log.error("provider request failed", { provider: "payrex", err: error });
        throw error;
      }
    },
  };
}
