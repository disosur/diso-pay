import { describe, expect, test } from "bun:test";
import { createFxRateProvider } from "../src/fx.ts";

const NOW = 1_800_000_000_000;

type RecordedRequest = {
  url: string;
  init?: RequestInit;
};

function quoteResponse(input: {
  id?: string;
  baseRate: number;
  lockExpiresAt?: number;
  lockStatus?: string;
}): Response {
  return Response.json({
    id: input.id ?? "fxq_test_1",
    object: "fx_quote",
    lock_status: input.lockStatus ?? "active",
    lock_expires_at:
      input.lockExpiresAt === undefined
        ? (NOW + 3_600_000) / 1000
        : input.lockExpiresAt,
    rates: {
      usd: {
        exchange_rate: input.baseRate * 0.98,
        rate_details: {
          base_rate: input.baseRate,
          fx_fee_rate: 0.02,
        },
      },
    },
  });
}

describe("createFxRateProvider", () => {
  test("fetches a USD to PHP quote and caches it", async () => {
    const requests: RecordedRequest[] = [];

    const provider = createFxRateProvider({
      stripeSecretKey: "sk_test_123",
      fallbackPhpPerUsd: 58,
      lockDuration: "hour",
      now: () => NOW,
      fetchImpl: async (input, init) => {
        requests.push({ url: String(input), init });
        return quoteResponse({ baseRate: 59.25 });
      },
    });

    const first = await provider.getPhpPerUsd();

    expect(first).toEqual({
      php_per_usd: 59.25,
      source: "stripe",
      quote_id: "fxq_test_1",
      locked_until: NOW + 3_600_000,
    });

    const second = await provider.getPhpPerUsd();

    expect(second).toBe(first);
    expect(requests).toHaveLength(1);

    const [request] = requests;
    expect(request?.url).toBe("https://api.stripe.com/v1/fx_quotes");
    expect(request?.init?.method).toBe("POST");

    const headers = new Headers(request?.init?.headers);
    expect(headers.get("authorization")).toBe("Bearer sk_test_123");
    expect(headers.get("stripe-version")).toBe("2026-09-30.preview");
    expect(headers.get("content-type")).toBe(
      "application/x-www-form-urlencoded",
    );

    const body = new URLSearchParams(String(request?.init?.body));
    expect(body.get("to_currency")).toBe("php");
    expect(body.getAll("from_currencies[]")).toEqual(["usd"]);
    expect(body.get("lock_duration")).toBe("hour");
  });

  test("uses the static rate when no Stripe key is configured", async () => {
    let calls = 0;

    const provider = createFxRateProvider({
      stripeSecretKey: "",
      fallbackPhpPerUsd: 57.5,
      fetchImpl: async () => {
        calls += 1;
        return quoteResponse({ baseRate: 59.25 });
      },
    });

    const rate = await provider.getPhpPerUsd();

    expect(rate).toEqual({
      php_per_usd: 57.5,
      source: "static",
      quote_id: "",
      locked_until: 0,
    });
    expect(calls).toBe(0);
  });

  test("falls back to the static rate when the quote request fails", async () => {
    let calls = 0;

    const provider = createFxRateProvider({
      stripeSecretKey: "sk_test_123",
      fallbackPhpPerUsd: 58,
      now: () => NOW,
      fetchImpl: async () => {
        calls += 1;
        return new Response("unavailable", { status: 503 });
      },
    });

    const rate = await provider.getPhpPerUsd();

    expect(rate.source).toBe("static");
    expect(rate.php_per_usd).toBe(58);

    await provider.getPhpPerUsd();
    expect(calls).toBe(1);
  });

  test("refreshes the quote when its lock expires", async () => {
    let current = NOW;
    let calls = 0;

    const provider = createFxRateProvider({
      stripeSecretKey: "sk_test_123",
      fallbackPhpPerUsd: 58,
      now: () => current,
      fetchImpl: async () => {
        calls += 1;
        return quoteResponse({
          baseRate: 59 + calls,
          lockExpiresAt: (current + 3_600_000) / 1000,
        });
      },
    });

    const first = await provider.getPhpPerUsd();
    expect(first.php_per_usd).toBe(60);

    current += 3_600_000;

    const second = await provider.getPhpPerUsd();
    expect(second.php_per_usd).toBe(61);
    expect(calls).toBe(2);
  });

  test("reports no lock when Stripe returns an unlocked quote", async () => {
    let current = NOW;
    let calls = 0;

    const provider = createFxRateProvider({
      stripeSecretKey: "sk_test_123",
      fallbackPhpPerUsd: 58,
      lockDuration: "none",
      now: () => current,
      fetchImpl: async () => {
        calls += 1;
        return Response.json({
          id: "fxq_test_1",
          lock_status: "active",
          rates: { usd: { rate_details: { base_rate: 59.25 } } },
        });
      },
    });

    const first = await provider.getPhpPerUsd();
    expect(first.locked_until).toBe(0);

    current += 60_000;
    await provider.getPhpPerUsd();
    expect(calls).toBe(2);
  });

  test("rejects expired or malformed quotes", async () => {
    for (const response of [
      quoteResponse({ baseRate: 59.25, lockStatus: "expired" }),
      Response.json({ id: "fxq_test_1", rates: {} }),
      Response.json({ id: "fxq_test_1", rates: { usd: { rate_details: {} } } }),
    ]) {
      const provider = createFxRateProvider({
        stripeSecretKey: "sk_test_123",
        fallbackPhpPerUsd: 58,
        now: () => NOW,
        fetchImpl: async () => response,
      });

      const rate = await provider.getPhpPerUsd();

      expect(rate.source).toBe("static");
      expect(rate.php_per_usd).toBe(58);
    }
  });

  test("deduplicates concurrent quote requests", async () => {
    let calls = 0;
    let resolveFetch: ((response: Response) => void) | undefined;

    const provider = createFxRateProvider({
      stripeSecretKey: "sk_test_123",
      fallbackPhpPerUsd: 58,
      now: () => NOW,
      fetchImpl: () => {
        calls += 1;
        return new Promise<Response>((resolve) => {
          resolveFetch = resolve;
        });
      },
    });

    const first = provider.getPhpPerUsd();
    const second = provider.getPhpPerUsd();

    resolveFetch?.(quoteResponse({ baseRate: 59.25 }));

    const [a, b] = await Promise.all([first, second]);

    expect(calls).toBe(1);
    expect(a).toBe(b);
  });
});
