import { DEFAULT_PHP_PER_USD, DEFAULT_TRANSACTION_TTL_SECONDS } from "@diso-pay/contracts";

export type PaymentConfig = {
  httpPort: number;
  grpcAddress: string;
  ledgerAddress: string;
  processorPublicUrl: string;
  checkoutReturnBaseUrl: string;
  fxPhpPerUsd: number;
  transactionTtlSeconds: number;
  stripeSecretKey: string;
  stripeWebhookSecret: string;
  payrexSecretKey: string;
  payrexWebhookSecret: string;
  payrexApiBaseUrl: string;
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
    fxPhpPerUsd: envNumber("FX_PHP_PER_USD", DEFAULT_PHP_PER_USD),
    transactionTtlSeconds: envNumber(
      "TRANSACTION_TTL_SECONDS",
      DEFAULT_TRANSACTION_TTL_SECONDS,
    ),
    stripeSecretKey: envString("STRIPE_SECRET_KEY"),
    stripeWebhookSecret: envString("STRIPE_WEBHOOK_SECRET"),
    payrexSecretKey: envString("PAYREX_SECRET_API_KEY"),
    payrexWebhookSecret: envString("PAYREX_WEBHOOK_SECRET"),
    payrexApiBaseUrl: envString(
      "PAYREX_API_BASE_URL",
      "https://api.payrexhq.com",
    ),
  };
}
