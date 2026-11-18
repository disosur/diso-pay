import {
  CHECKOUT_RETURNED,
  type CheckoutOptions,
  type CheckoutSessionResponse,
  type CreateSessionInput,
  type Currency,
  type LineItem,
  type PaymentMethod,
  type ReturnedPayload,
  type Transaction,
  type TransactionStatus,
} from "@diso-pay/contracts";
import { isRpcCode, rpcErrorMessage, status as grpcStatus, statusName } from "@diso-pay/grpc";
import { ledgerClient, paymentClient } from "./grpc.server.ts";
import { log } from "./logger.server.ts";

export type PublicTransaction = {
  id: string;
  status: TransactionStatus;
  currency: Currency;
  amount_total: number;
  line_items: LineItem[];
  expires_at: number;
  reference: string;
  description: string;
  payment_method: PaymentMethod | "";
  created_at: number;
};

export type CheckoutPageResult =
  | { ok: true; transaction: PublicTransaction; options: CheckoutOptions }
  | { ok: false; reason: "not_found" | "unavailable" };

export type StartedSession = {
  url: string;
  provider: string;
  method: PaymentMethod;
  currency: Currency;
  amount: number;
  reused: boolean;
};

function toPublicTransaction(transaction: Transaction): PublicTransaction {
  return {
    id: transaction.id,
    status: transaction.status,
    currency: transaction.currency,
    amount_total: transaction.amount_total,
    line_items: transaction.line_items,
    expires_at: transaction.expires_at,
    reference: transaction.reference,
    description: transaction.description,
    payment_method: transaction.payment_method,
    created_at: transaction.created_at,
  };
}

function urlHost(value: string): string {
  try {
    return new URL(value).host;
  } catch {
    return "invalid_url";
  }
}

function grpcErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return statusName(code);
  }

  return "UNKNOWN";
}

export async function getCheckoutPageData(
  transactionId: string,
): Promise<CheckoutPageResult> {
  try {
    const [transactionResponse, options] = await Promise.all([
      ledgerClient().GetTransaction({ transaction_id: transactionId }),
      paymentClient().GetCheckoutOptions({}),
    ]);

    log.info("checkout page data", {
      transaction_id: transactionId,
      found: true,
      status: transactionResponse.transaction.status,
    });

    return {
      ok: true,
      transaction: toPublicTransaction(transactionResponse.transaction),
      options,
    };
  } catch (error) {
    if (isRpcCode(error, grpcStatus.NOT_FOUND)) {
      log.info("checkout page data", {
        transaction_id: transactionId,
        found: false,
        status: "not_found",
      });
      return { ok: false, reason: "not_found" };
    }

    log.error("checkout grpc call failed", {
      operation: "getCheckoutPageData",
      code: grpcErrorCode(error),
      message: rpcErrorMessage(error),
      err: error,
    });
    return { ok: false, reason: "unavailable" };
  }
}

export async function startCheckoutSession(
  input: CreateSessionInput,
): Promise<StartedSession> {
  let response: CheckoutSessionResponse;

  try {
    response = await paymentClient().CreateCheckoutSession({
      transaction_id: input.transaction_id,
      method: input.method,
      currency: input.currency,
    });
  } catch (error) {
    log.error("checkout grpc call failed", {
      operation: "CreateCheckoutSession",
      code: grpcErrorCode(error),
      message: rpcErrorMessage(error),
      err: error,
    });
    throw error;
  }

  log.info("checkout session started", {
    transaction_id: input.transaction_id,
    method: response.method,
    currency: response.currency,
    provider: response.provider,
    reused: response.reused,
    url_host: urlHost(response.url),
  });

  return {
    url: response.url,
    provider: response.provider,
    method: response.method,
    currency: response.currency,
    amount: response.amount,
    reused: response.reused,
  };
}

export async function handleCheckoutReturn(
  transactionId: string,
  outcome: "success" | "cancel",
): Promise<string | null> {
  let transaction: Transaction;

  try {
    const response = await ledgerClient().GetTransaction({
      transaction_id: transactionId,
    });
    transaction = response.transaction;
  } catch (error) {
    if (isRpcCode(error, grpcStatus.NOT_FOUND)) return null;

    log.error("checkout grpc call failed", {
      operation: "GetTransaction",
      transaction_id: transactionId,
      code: grpcErrorCode(error),
      message: rpcErrorMessage(error),
      err: error,
    });
    throw error;
  }

  const lastSession = transaction.sessions.at(-1);
  const payload: ReturnedPayload = {
    outcome,
    provider: lastSession?.provider ?? "",
    method: lastSession?.method ?? "",
  };

  try {
    await ledgerClient().AppendEvent({
      transaction_id: transactionId,
      type: CHECKOUT_RETURNED,
      payload_json: JSON.stringify(payload),
      idempotency_key: `checkout.returned:${transactionId}:${outcome}`,
    });
  } catch (error) {
    log.error("checkout return event failed", {
      operation: "AppendEvent",
      transaction_id: transactionId,
      outcome,
      code: grpcErrorCode(error),
      message: rpcErrorMessage(error),
      err: error,
    });
  }

  return outcome === "success" ? transaction.success_url : transaction.cancel_url;
}
