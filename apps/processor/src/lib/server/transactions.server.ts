import {
  createTransactionId,
  lineItemsTotal,
  MAX_TRANSACTION_TTL_SECONDS,
  TRANSACTION_CREATED,
  type CreatedPayload,
  type ProcessPaymentInput,
  type Transaction,
} from "@diso-pay/contracts";
import { isRpcCode, rpcErrorMessage, status as grpcStatus, statusName } from "@diso-pay/grpc";
import { publicOrigin, transactionTtlSeconds } from "./config.server.ts";
import { ledgerClient } from "./grpc.server.ts";
import { log } from "./logger.server.ts";

export type CreatedTransaction = {
  id: string;
  url: string;
  status: Transaction["status"];
  currency: Transaction["currency"];
  amount_total: number;
  expires_at: number;
  reused: boolean;
};

function resolveExpiry(requested: number | undefined, now: number): number {
  const defaultExpiry = now + transactionTtlSeconds() * 1000;

  if (requested === undefined) return defaultExpiry;

  const requestedMs = requested * 1000;
  if (requestedMs <= now) {
    throw new Error("expires_at_in_the_past");
  }

  const maximum = now + MAX_TRANSACTION_TTL_SECONDS * 1000;
  if (requestedMs > maximum) {
    throw new Error("expires_at_too_far_in_the_future");
  }

  return requestedMs;
}

function ledgerFailure(error: unknown, operation: string): never {
  log.error("ledger grpc call failed", {
    operation,
    code: grpcErrorCode(error),
    message: rpcErrorMessage(error),
    err: error,
  });

  if (isRpcCode(error, grpcStatus.UNAVAILABLE)) {
    throw new Error("ledger_unavailable");
  }

  if (isRpcCode(error, grpcStatus.DEADLINE_EXCEEDED)) {
    throw new Error("ledger_timeout");
  }

  throw error;
}

function grpcErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return statusName(code);
  }

  return "UNKNOWN";
}

export async function createTransaction(
  input: ProcessPaymentInput,
  requestOrigin: string,
): Promise<CreatedTransaction> {
  const now = Date.now();
  const origin = publicOrigin(requestOrigin);
  const amountTotal = lineItemsTotal(input.line_items);

  if (input.customer_reference_id) {
    try {
      const { transaction } = await ledgerClient().FindActiveTransaction({
        reference: input.customer_reference_id,
      });

      if (
        transaction &&
        transaction.id &&
        transaction.currency === input.currency &&
        transaction.amount_total === amountTotal &&
        transaction.payment_method === (input.payment_method ?? "")
      ) {
        return {
          id: transaction.id,
          url: `${origin}/payment/${transaction.id}`,
          status: transaction.status,
          currency: transaction.currency,
          amount_total: transaction.amount_total,
          expires_at: Math.floor(transaction.expires_at / 1000),
          reused: true,
        };
      }
    } catch (error) {
      ledgerFailure(error, "FindActiveTransaction");
    }
  }

  const id = createTransactionId();
  const expiresAt = resolveExpiry(input.expires_at, now);

  const payload: CreatedPayload = {
    currency: input.currency,
    amount_total: amountTotal,
    line_items: input.line_items,
    success_url: input.success_url,
    cancel_url: input.cancel_url,
    ...(input.customer_reference_id ? { reference: input.customer_reference_id } : {}),
    ...(input.description ? { description: input.description } : {}),
    ...(input.customer_email ? { customer_email: input.customer_email } : {}),
    ...(input.payment_method ? { payment_method: input.payment_method } : {}),
    ...(input.metadata ? { metadata: input.metadata } : {}),
    expires_at: expiresAt,
  };

  try {
    await ledgerClient().AppendEvent({
      transaction_id: id,
      type: TRANSACTION_CREATED,
      payload_json: JSON.stringify(payload),
      idempotency_key: `transaction.created:${id}`,
    });
  } catch (error) {
    ledgerFailure(error, "AppendEvent");
  }

  return {
    id,
    url: `${origin}/payment/${id}`,
    status: "pending",
    currency: payload.currency,
    amount_total: payload.amount_total,
    expires_at: Math.floor(expiresAt / 1000),
    reused: false,
  };
}
