import { DEFAULT_TRANSACTION_TTL_SECONDS } from "@diso-pay/contracts";

export function transactionTtlSeconds(): number {
  const raw = process.env.TRANSACTION_TTL_SECONDS;
  if (!raw) return DEFAULT_TRANSACTION_TTL_SECONDS;

  const parsed = Number(raw);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_TRANSACTION_TTL_SECONDS;
}

export function publicOrigin(fallback: string): string {
  const configured = process.env.PUBLIC_ORIGIN;
  if (configured && configured.trim().length > 0) {
    return configured.trim().replace(/\/+$/, "");
  }

  return fallback.replace(/\/+$/, "");
}
