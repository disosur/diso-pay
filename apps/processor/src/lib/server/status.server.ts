import {
  foldTransaction,
  type LedgerEvent,
  type Transaction,
  type TransactionStatus,
} from "@diso-pay/contracts";
import {
  isRpcCode,
  rpcErrorMessage,
  status as grpcStatus,
  statusName,
} from "@diso-pay/grpc";
import { toPublicTransaction, type PublicTransaction } from "./checkout.server.ts";
import { ledgerClient } from "./grpc.server.ts";
import { log } from "./logger.server.ts";

export type StatusHistoryEntry = {
  sequence: number | null;
  type: string;
  status: TransactionStatus;
  created_at: number;
  at: string;
  payload?: unknown;
  derived?: boolean;
};

export type TransactionStatusResult =
  | {
      ok: true;
      transaction: PublicTransaction;
      status_history: StatusHistoryEntry[];
    }
  | { ok: false; reason: "not_found" | "unavailable" };

function grpcErrorCode(error: unknown): string {
  if (typeof error === "object" && error !== null && "code" in error) {
    const code = (error as { code: unknown }).code;
    if (typeof code === "number") return statusName(code);
  }

  return "UNKNOWN";
}

function parseEventPayload(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function isEmptyPayload(value: unknown): boolean {
  if (value === null || value === undefined) return true;

  if (typeof value === "object") {
    return Object.keys(value).length === 0;
  }

  return typeof value === "string" ? value.length === 0 : false;
}

function buildStatusHistory(
  events: LedgerEvent[],
  transaction: Transaction,
): StatusHistoryEntry[] {
  const history: StatusHistoryEntry[] = events.map((event, index) => {
    const folded = foldTransaction(events.slice(0, index + 1), event.created_at);
    const payload = parseEventPayload(event.payload_json);

    return {
      sequence: event.sequence,
      type: event.type,
      status: folded?.status ?? transaction.status,
      created_at: event.created_at,
      at: new Date(event.created_at).toISOString(),
      ...(isEmptyPayload(payload) ? {} : { payload }),
    };
  });

  const lastEventAt = events.at(-1)?.created_at ?? 0;

  if (
    transaction.status === "expired" &&
    lastEventAt < transaction.expires_at
  ) {
    history.push({
      sequence: null,
      type: "transaction.expired",
      status: "expired",
      created_at: transaction.expires_at,
      at: new Date(transaction.expires_at).toISOString(),
      derived: true,
    });
  }

  return history;
}

function ledgerFailure(
  error: unknown,
  operation: string,
  fields: Record<string, unknown>,
): TransactionStatusResult {
  log.error("ledger grpc call failed", {
    operation,
    code: grpcErrorCode(error),
    message: rpcErrorMessage(error),
    err: error,
    ...fields,
  });

  return { ok: false, reason: "unavailable" };
}

async function loadStatus(
  transaction: Transaction,
  operation: string,
  fields: Record<string, unknown>,
): Promise<TransactionStatusResult> {
  let events: LedgerEvent[];

  try {
    ({ events } = await ledgerClient().ListEvents({
      transaction_id: transaction.id,
    }));
  } catch (error) {
    return ledgerFailure(error, "ListEvents", fields);
  }

  log.info("transaction status", {
    transaction_id: transaction.id,
    reference: transaction.reference,
    status: transaction.status,
    events: events.length,
    operation,
  });

  return {
    ok: true,
    transaction: toPublicTransaction(transaction),
    status_history: buildStatusHistory(events, transaction),
  };
}

export async function getTransactionStatus(
  transactionId: string,
): Promise<TransactionStatusResult> {
  let transaction: Transaction;

  try {
    ({ transaction } = await ledgerClient().GetTransaction({
      transaction_id: transactionId,
    }));
  } catch (error) {
    if (isRpcCode(error, grpcStatus.NOT_FOUND)) {
      log.info("transaction status", {
        transaction_id: transactionId,
        found: false,
      });
      return { ok: false, reason: "not_found" };
    }

    return ledgerFailure(error, "GetTransaction", {
      transaction_id: transactionId,
    });
  }

  return loadStatus(transaction, "GetTransaction", {
    transaction_id: transactionId,
  });
}

export async function getTransactionStatusByReference(
  reference: string,
): Promise<TransactionStatusResult> {
  let transaction: Transaction | null;

  try {
    ({ transaction } = await ledgerClient().FindTransactionByReference({
      reference,
    }));
  } catch (error) {
    return ledgerFailure(error, "FindTransactionByReference", { reference });
  }

  if (!transaction) {
    log.info("transaction status", { reference, found: false });
    return { ok: false, reason: "not_found" };
  }

  return loadStatus(transaction, "FindTransactionByReference", { reference });
}
