import { DEFAULT_PHP_PER_USD, DEFAULT_TRANSACTION_TTL_SECONDS } from "@diso-pay/contracts";
import { FX_LOCK_DURATIONS, type FxLockDuration } from "./fx.ts";

export type PaymentConfig = {
  httpPort: number;
  grpcAddress: string;
  ledgerAddress: string;
  processorPublicUrl: string;
  checkoutReturnBaseUrl: string;
  fxPhpPerUsd: number;
  fxStripeLockDuration: FxLockDuration;
  transactionTtlSeconds: number;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  stripeApiBaseUrl: string;
  xenditSecretKey: string;
  xenditWebhookToken: string;
  xenditApiBaseUrl: string;
};

function envString(name: string, fallback = ""): string {
  const value = process.env[name];
  return value && value.trim().length > 0 ? value.trim() : fallback;
}

function envNumber(name: string, fallback: number): number {
  const value = process.env[name];
  if (!value) return fallback;

  const parsed = Number(value);
  if (!Number.isFinite(parsed)) {
    throw new Error(`invalid_number_env:${name}`);
  }

  return parsed;
}

function envPositiveNumber(name: string, fallback: number): number {
  const parsed = envNumber(name, fallback);
  if (parsed <= 0) {
    throw new Error(`invalid_number_env:${name}`);
  }

  return parsed;
}

function envChoice<T extends string>(
  name: string,
  choices: readonly T[],
  fallback: T,
): T {
  const value = envString(name);
  if (!value) return fallback;
  if (!(choices as readonly string[]).includes(value)) {
    throw new Error(`invalid_choice_env:${name}`);
  }

  return value as T;
}

export function loadConfig(): PaymentConfig {
  return {
    httpPort: envNumber("PORT", 4012),
    grpcAddress: `${envString("PAYMENT_GRPC_HOST", "127.0.0.1")}:${envNumber(
      "PAYMENT_GRPC_PORT",
      50052,
    )}`,
    ledgerAddress: envString("LEDGER_GRPC_ADDRESS", "127.0.0.1:50051"),
    processorPublicUrl: envString(
      "PROCESSOR_PUBLIC_URL",
      "http://localhost:3000",
    ).replace(/\/+$/, ""),
    checkoutReturnBaseUrl: envString("CHECKOUT_RETURN_BASE_URL").replace(/\/+$/, ""),
    fxPhpPerUsd: envPositiveNumber("FX_PHP_PER_USD", DEFAULT_PHP_PER_USD),
    fxStripeLockDuration: envChoice(
      "FX_STRIPE_LOCK_DURATION",
      FX_LOCK_DURATIONS,
      "hour",
    ),
    transactionTtlSeconds: envNumber(
      "TRANSACTION_TTL_SECONDS",
      DEFAULT_TRANSACTION_TTL_SECONDS,
    ),
    stripeSecretKey: envString("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: envString("STRIPE_WEBHOOK_SECRET"),
    stripeApiBaseUrl: envString("STRIPE_API_BASE_URL", "https://api.stripe.com"),
    xenditSecretKey: envString("XENDIT_SECRET_API_KEY"),
    xenditWebhookToken: envString("XENDIT_WEBHOOK_TOKEN"),
    xenditApiBaseUrl: envString(
      "XENDIT_API_BASE_URL",
      "https://api.xendit.co",
    ),
  };
}
