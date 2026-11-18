export * from "./events.ts";
export * from "./methods.ts";
export * from "./money.ts";
export * from "./proto/index.ts";
export * from "./schemas.ts";
export * from "./types.ts";

export function createTransactionId(): string {
  return `txn_${crypto.randomUUID().replaceAll("-", "")}`;
}

export const DEFAULT_TRANSACTION_TTL_SECONDS = 30 * 60;
export const MAX_TRANSACTION_TTL_SECONDS = 24 * 60 * 60;
