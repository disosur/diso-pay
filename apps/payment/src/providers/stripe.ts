import Stripe from "stripe";
import { log } from "../logger.ts";
import type { CheckoutProvider, ProviderCheckoutInput } from "./types.ts";
import { ProviderError } from "./types.ts";

const MINIMUM_SESSION_LIFETIME_MS = 31 * 60 * 1000;
const MAXIMUM_SESSION_LIFETIME_MS = 24 * 60 * 60 * 1000;

function toProviderError(error: unknown): ProviderError {
  if (error instanceof ProviderError) return error;

  if (error instanceof Stripe.errors.StripeAuthenticationError) {
    return new ProviderError("stripe", "authentication", "stripe_authentication_failed");
  }

  if (error instanceof Stripe.errors.StripeInvalidRequestError) {
    return new ProviderError(
      "stripe",
      "invalid_request",
      "stripe_request_invalid",
      error.message,
    );
  }

  if (error instanceof Stripe.errors.StripeError) {
    return new ProviderError(
      "stripe",
      "unavailable",
      "stripe_unavailable",
      error.message,
    );
  }

  return new ProviderError(
    "stripe",
    "unavailable",
    "stripe_unexpected_error",
    error instanceof Error ? error.message : String(error),
  );
}

export function createStripeProvider(secretKey: string): CheckoutProvider {
  let client: Stripe | undefined;

  const getClient = (): Stripe => {
    if (!secretKey) {
      throw new ProviderError("stripe", "authentication", "stripe_secret_key_missing");
    }

    client ??= new Stripe(secretKey, { maxNetworkRetries: 2, timeout: 15_000 });
    return client;
  };

  return {
    id: "stripe",

    async createCheckoutSession(input: ProviderCheckoutInput) {
      const now = Date.now();
      const expiresAt = Math.min(
        Math.max(input.transaction.expires_at, now + MINIMUM_SESSION_LIFETIME_MS),
        now + MAXIMUM_SESSION_LIFETIME_MS,
      );

      log.debug("provider request", {
        provider: "stripe",
        currency: input.plan.currency,
        amount: input.plan.amount,
        line_items: input.plan.line_items.length,
        expires_at: expiresAt,
      });

      try {
        const session = await getClient().checkout.sessions.create(
          {
            mode: "payment",
            allowed_payment_method_types: ["card"],
            success_url: input.success_url,
            cancel_url: input.cancel_url,
            line_items: input.plan.line_items.map((item) => ({
              quantity: item.quantity,
              price_data: {
                currency: input.plan.currency.toLowerCase(),
                unit_amount: item.amount,
                product_data: {
                  name: item.name,
                  ...(item.image ? { images: [item.image] } : {}),
                },
              },
            })),
            ...(input.transaction.customer_email
              ? { customer_email: input.transaction.customer_email }
              : {}),
            client_reference_id: input.transaction.reference || input.transaction.id,
            metadata: {
              transaction_id: input.transaction.id,
              ...input.transaction.metadata,
            },
            expires_at: Math.floor(expiresAt / 1000),
          },
          {
            idempotencyKey: [
              input.transaction.id,
              input.plan.method,
              input.plan.currency,
              input.plan.amount,
            ].join(":"),
          },
        );

        if (!session.url) {
          throw new ProviderError(
            "stripe",
            "unavailable",
            "stripe_checkout_url_missing",
            session.id,
          );
        }

        log.info("provider request completed", {
          provider: "stripe",
          currency: input.plan.currency,
          amount: input.plan.amount,
          provider_session_id: session.id,
        });

        return {
          provider_session_id: session.id,
          url: session.url,
          expires_at: expiresAt,
        };
      } catch (error) {
        const providerError = toProviderError(error);
        log.error("provider request failed", {
          provider: "stripe",
          kind: providerError.kind,
          message: providerError.message,
        });
        throw providerError;
      }
    },
  };
}
