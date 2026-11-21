import type { FxRateSource } from "@diso-pay/contracts";
import { log } from "./logger.ts";

export const FX_LOCK_DURATIONS = ["none", "five_minutes", "hour", "day"] as const;
export type FxLockDuration = (typeof FX_LOCK_DURATIONS)[number];

export type FxRate = {
  php_per_usd: number;
  source: FxRateSource;
  quote_id: string;
  locked_until: number;
};

type CachedRate = {
  rate: FxRate;
  cache_until: number;
};

export type FxRateProvider = {
  getPhpPerUsd(): Promise<FxRate>;
};

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

const STRIPE_API_VERSION = "2026-09-30.preview";
const FAILURE_COOLDOWN_MS = 60_000;
const UNLOCKED_QUOTE_TTL_MS = 60_000;
const REQUEST_TIMEOUT_MS = 10_000;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function parseQuote(
  payload: unknown,
  now: number,
): {
  phpPerUsd: number;
  quoteId: string;
  lockedUntil: number;
  cacheUntil: number;
} {
  if (!isRecord(payload)) throw new Error("invalid_fx_quote_response");
  if (payload.lock_status === "expired") throw new Error("fx_quote_expired");

  const quoteId = typeof payload.id === "string" ? payload.id : "";
  const rates = isRecord(payload.rates) ? payload.rates : undefined;
  const usd = rates && isRecord(rates.usd) ? rates.usd : undefined;
  const details =
    usd && isRecord(usd.rate_details) ? usd.rate_details : undefined;
  const baseRate = details?.base_rate;

  if (typeof baseRate !== "number" || !Number.isFinite(baseRate) || baseRate <= 0) {
    throw new Error("invalid_fx_quote_rate");
  }

  const expiresAt =
    typeof payload.lock_expires_at === "number"
      ? payload.lock_expires_at * 1000
      : Number.NaN;
  const lockedUntil =
    Number.isFinite(expiresAt) && expiresAt > now ? expiresAt : 0;

  return {
    phpPerUsd: baseRate,
    quoteId,
    lockedUntil,
    cacheUntil:
      lockedUntil > 0 ? lockedUntil : now + UNLOCKED_QUOTE_TTL_MS,
  };
}

export function createFxRateProvider(input: {
  stripeSecretKey: string;
  fallbackPhpPerUsd: number;
  lockDuration?: FxLockDuration;
  apiBaseUrl?: string;
  fetchImpl?: FetchLike;
  now?: () => number;
}): FxRateProvider {
  const {
    stripeSecretKey,
    fallbackPhpPerUsd,
    lockDuration = "hour",
  } = input;
  const apiBaseUrl = (input.apiBaseUrl ?? "https://api.stripe.com").replace(
    /\/+$/,
    "",
  );
  const fetchImpl = input.fetchImpl ?? fetch;
  const now = input.now ?? Date.now;

  let cached: CachedRate | null = null;
  let pending: Promise<CachedRate> | null = null;
  let retryAfter = 0;

  function staticRate(): FxRate {
    return {
      php_per_usd: fallbackPhpPerUsd,
      source: "static",
      quote_id: "",
      locked_until: 0,
    };
  }

  async function requestQuote(): Promise<CachedRate> {
    const body = new URLSearchParams({
      to_currency: "php",
      lock_duration: lockDuration,
    });
    body.append("from_currencies[]", "usd");

    const response = await fetchImpl(`${apiBaseUrl}/v1/fx_quotes`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${stripeSecretKey}`,
        "content-type": "application/x-www-form-urlencoded",
        "stripe-version": STRIPE_API_VERSION,
      },
      body: body.toString(),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });

    if (!response.ok) {
      throw new Error(`stripe_fx_quote_failed:${response.status}`);
    }

    const parsed = parseQuote(await response.json(), now());

    return {
      rate: {
        php_per_usd: parsed.phpPerUsd,
        source: "stripe",
        quote_id: parsed.quoteId,
        locked_until: parsed.lockedUntil,
      },
      cache_until: parsed.cacheUntil,
    };
  }

  async function refresh(): Promise<CachedRate> {
    try {
      const entry = await requestQuote();
      cached = entry;
      retryAfter = 0;

      log.info("fx quote refreshed", {
        quote_id: entry.rate.quote_id,
        php_per_usd: entry.rate.php_per_usd,
        lock_duration: lockDuration,
        locked_until:
          entry.rate.locked_until > 0
            ? new Date(entry.rate.locked_until).toISOString()
            : null,
      });

      return entry;
    } catch (error) {
      retryAfter = now() + FAILURE_COOLDOWN_MS;

      log.warn("fx quote unavailable", {
        message: error instanceof Error ? error.message : String(error),
        fallback_php_per_usd: fallbackPhpPerUsd,
        retry_in_seconds: FAILURE_COOLDOWN_MS / 1000,
      });

      if (cached && cached.cache_until > now()) return cached;
      return { rate: staticRate(), cache_until: 0 };
    }
  }

  return {
    async getPhpPerUsd(): Promise<FxRate> {
      if (!stripeSecretKey) return staticRate();

      const current = now();
      if (cached && current < cached.cache_until) return cached.rate;

      if (current < retryAfter) {
        if (cached && cached.cache_until > current) return cached.rate;
        return staticRate();
      }

      if (pending) return (await pending).rate;

      pending = refresh().finally(() => {
        pending = null;
      });

      return (await pending).rate;
    },
  };
}
