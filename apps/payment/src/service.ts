import {
  CHECKOUT_SESSION_CREATED,
  CHECKOUT_SESSION_REUSED,
  CURRENCIES,
  findReusableSession,
  isTransactionActive,
  METHOD_CATALOG,
  PAYMENT_METHODS,
  planCharge,
  validateChargePlan,
  type CheckoutOptions,
  type CheckoutSessionResponse,
  type CreateCheckoutSessionRequest,
  type Currency,
  type LedgerClient,
  type PaymentMethod,
  type Provider,
  type SessionPayload,
  type Transaction,
} from "@diso-pay/contracts";
import { rpcError, status as grpcStatus } from "@diso-pay/grpc";
import type { PaymentConfig } from "./config.ts";
import { log } from "./logger.ts";
import type { ProviderRegistry } from "./providers/index.ts";
import { ProviderError } from "./providers/index.ts";

export type PaymentService = ReturnType<typeof createPaymentService>;

function isCurrency(value: string): value is Currency {
  return (CURRENCIES as readonly string[]).includes(value);
}

function isMethod(value: string): value is PaymentMethod {
  return (PAYMENT_METHODS as readonly string[]).includes(value);
}

function isLoopbackHostname(hostname: string): boolean {
  const host = hostname.replace(/^\[|\]$/g, "").toLowerCase();

  return (
    host === "localhost" ||
    host.endsWith(".localhost") ||
    host === "::1" ||
    host === "0.0.0.0" ||
    host.startsWith("127.")
  );
}

function isLoopbackUrl(value: string): boolean {
  try {
    return isLoopbackHostname(new URL(value).hostname);
  } catch {
    return true;
  }
}

let warnedUntrackedPayrexReturn = false;

function providerReturnUrls(
  config: PaymentConfig,
  transaction: Transaction,
  provider: Provider,
): { success_url: string; cancel_url: string; tracked: boolean } {
  const base = config.checkoutReturnBaseUrl || config.processorPublicUrl;

  if (provider === "payrex" && isLoopbackUrl(base)) {
    if (!warnedUntrackedPayrexReturn) {
      warnedUntrackedPayrexReturn = true;
      log.warn("payrex loopback return urls", {
        base,
        reason: "payrex_rejects_loopback_redirect_urls",
        fallback: "merchant_success_cancel_urls",
      });
    }

    return {
      success_url: transaction.success_url,
      cancel_url: transaction.cancel_url,
      tracked: false,
    };
  }

  const path = `/payment/${encodeURIComponent(transaction.id)}/return`;
  const success = new URL(`${base}${path}`);
  success.searchParams.set("outcome", "success");
  const cancel = new URL(`${base}${path}`);
  cancel.searchParams.set("outcome", "cancel");

  return {
    success_url: success.toString(),
    cancel_url: cancel.toString(),
    tracked: true,
  };
}

function providerRpcError(error: ProviderError): never {
  switch (error.kind) {
    case "authentication":
      throw rpcError(grpcStatus.FAILED_PRECONDITION, `provider_authentication_failed:${error.provider}:${error.detail}`);
    case "invalid_request":
      throw rpcError(grpcStatus.INVALID_ARGUMENT, `${error.message}:${error.detail}`);
    default:
      throw rpcError(grpcStatus.UNAVAILABLE, `${error.message}:${error.detail}`);
  }
}

export function createPaymentService(input: {
  config: PaymentConfig;
  ledger: LedgerClient;
  providers: ProviderRegistry;
}) {
  const { config, ledger, providers } = input;

  async function loadTransaction(transactionId: string): Promise<Transaction> {
    let response;
    try {
      response = await ledger.GetTransaction({ transaction_id: transactionId });
    } catch (error) {
      if (
        typeof error === "object" &&
        error !== null &&
        "code" in error &&
        (error as { code: unknown }).code === grpcStatus.NOT_FOUND
      ) {
        throw rpcError(grpcStatus.NOT_FOUND, "transaction_not_found");
      }

      throw error;
    }

    const transaction = response.transaction;
    if (!transaction || !transaction.id) {
      throw rpcError(grpcStatus.NOT_FOUND, "transaction_not_found");
    }

    return transaction;
  }

  async function appendEvent(
    transactionId: string,
    type: string,
    payload: SessionPayload,
    idempotencyKey: string,
  ): Promise<void> {
    try {
      await ledger.AppendEvent({
        transaction_id: transactionId,
        type,
        payload_json: JSON.stringify(payload),
        idempotency_key: idempotencyKey,
      });
    } catch (error) {
      log.error("ledger append failed", {
        transaction_id: transactionId,
        type,
        idempotency_key: idempotencyKey,
        err: error,
      });
    }
  }

  return {
    async getCheckoutOptions(): Promise<CheckoutOptions> {
      return {
        methods: METHOD_CATALOG,
        currencies: [...CURRENCIES],
        fx_php_per_usd: String(config.fxPhpPerUsd),
        transaction_ttl_seconds: config.transactionTtlSeconds,
      };
    },

    async createCheckoutSession(
      request: CreateCheckoutSessionRequest,
    ): Promise<CheckoutSessionResponse> {
      if (!request.transaction_id) {
        throw rpcError(grpcStatus.INVALID_ARGUMENT, "missing_transaction_id");
      }

      if (!isMethod(request.method)) {
        throw rpcError(grpcStatus.INVALID_ARGUMENT, "unsupported_payment_method");
      }

      const transaction = await loadTransaction(request.transaction_id);
      const now = Date.now();

      if (transaction.status === "completed") {
        throw rpcError(grpcStatus.FAILED_PRECONDITION, "transaction_already_completed");
      }

      if (!isTransactionActive(transaction, now)) {
        throw rpcError(grpcStatus.FAILED_PRECONDITION, "transaction_not_active");
      }

      if (transaction.payment_method && transaction.payment_method !== request.method) {
        throw rpcError(
          grpcStatus.INVALID_ARGUMENT,
          `payment_method_not_allowed:${transaction.payment_method}`,
        );
      }

      const requestedCurrency = request.currency || transaction.currency;
      if (!isCurrency(requestedCurrency)) {
        throw rpcError(grpcStatus.INVALID_ARGUMENT, "unsupported_currency");
      }

      const plan = planCharge({
        method: request.method,
        currency: requestedCurrency,
        source_currency: transaction.currency,
        line_items: transaction.line_items,
        phpPerUsd: config.fxPhpPerUsd,
      });

      const invalid = validateChargePlan(plan);
      if (invalid) {
        throw rpcError(grpcStatus.INVALID_ARGUMENT, invalid);
      }

      const reusable = findReusableSession(
        transaction,
        { method: plan.method, currency: plan.currency, amount: plan.amount },
        now,
      );

      if (reusable) {
        await appendEvent(
          transaction.id,
          CHECKOUT_SESSION_REUSED,
          {
            provider: reusable.provider,
            method: reusable.method,
            currency: reusable.currency,
            amount: reusable.amount,
            provider_session_id: reusable.provider_session_id,
            url: reusable.url,
            expires_at: reusable.expires_at,
          },
          `checkout.reuse:${transaction.id}:${reusable.provider_session_id}`,
        );

        log.info("checkout session reused", {
          transaction_id: transaction.id,
          provider: reusable.provider,
          method: reusable.method,
          requested_currency: requestedCurrency,
          currency: reusable.currency,
          amount: reusable.amount,
          provider_session_id: reusable.provider_session_id,
          reused: true,
        });

        return {
          transaction_id: transaction.id,
          provider: reusable.provider,
          method: reusable.method,
          currency: reusable.currency,
          amount: reusable.amount,
          provider_session_id: reusable.provider_session_id,
          url: reusable.url,
          expires_at: reusable.expires_at,
          reused: true,
        };
      }

      const provider = providers[plan.provider];
      if (!provider) {
        throw rpcError(grpcStatus.INTERNAL, `provider_not_configured:${plan.provider}`);
      }

      let session;
      try {
        const returnUrls = providerReturnUrls(config, transaction, plan.provider);
        session = await provider.createCheckoutSession({
          transaction,
          plan,
          success_url: returnUrls.success_url,
          cancel_url: returnUrls.cancel_url,
        });
      } catch (error) {
        if (error instanceof ProviderError) {
          const level = error.kind === "invalid_request" ? "warn" : "error";
          log[level]("provider checkout failed", {
            provider: error.provider,
            kind: error.kind,
            message: error.message,
            detail: error.detail.slice(0, 500),
          });
          providerRpcError(error);
        }

        log.error("provider checkout failed", {
          provider: plan.provider,
          err: error,
        });
        throw error;
      }

      await appendEvent(
        transaction.id,
        CHECKOUT_SESSION_CREATED,
        {
          provider: plan.provider,
          method: plan.method,
          currency: plan.currency,
          amount: plan.amount,
          provider_session_id: session.provider_session_id,
          url: session.url,
          expires_at: session.expires_at,
        },
        `checkout.session:${transaction.id}:${session.provider_session_id}`,
      );

      log.info("checkout session created", {
        transaction_id: transaction.id,
        method: plan.method,
        requested_currency: requestedCurrency,
        provider: plan.provider,
        currency: plan.currency,
        amount: plan.amount,
        reused: false,
      });

      return {
        transaction_id: transaction.id,
        provider: plan.provider,
        method: plan.method,
        currency: plan.currency,
        amount: plan.amount,
        provider_session_id: session.provider_session_id,
        url: session.url,
        expires_at: session.expires_at,
        reused: false,
      };
    },
  };
}
