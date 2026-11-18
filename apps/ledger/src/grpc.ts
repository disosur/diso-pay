import {
  parseCreatedPayload,
  TRANSACTION_CREATED,
  type AppendEventRequest,
  type FindActiveTransactionRequest,
  type GetTransactionRequest,
  type ListEventsRequest,
} from "@diso-pay/contracts";
import {
  RpcError,
  rpcError,
  status as grpcStatus,
  statusName,
  type UnaryHandler,
} from "@diso-pay/grpc";
import type { LedgerDatabase } from "./db/index.ts";
import { log } from "./logger.ts";
import {
  appendEvent,
  countEvents,
  findActiveTransaction,
  findEventByIdempotencyKey,
  getTransaction,
  listEvents,
} from "./repository.ts";

const MAX_PAYLOAD_BYTES = 64 * 1024;

type CallFields = Record<string, unknown>;

function requireString(value: unknown, field: string, max = 200): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw rpcError(grpcStatus.INVALID_ARGUMENT, `missing_${field}`);
  }

  if (value.length > max) {
    throw rpcError(grpcStatus.INVALID_ARGUMENT, `${field}_too_long`);
  }

  return value.trim();
}

function parsePayload(payloadJson: string): Record<string, unknown> {
  if (Buffer.byteLength(payloadJson, "utf8") > MAX_PAYLOAD_BYTES) {
    throw rpcError(grpcStatus.INVALID_ARGUMENT, "payload_too_large");
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(payloadJson);
  } catch {
    throw rpcError(grpcStatus.INVALID_ARGUMENT, "payload_not_json");
  }

  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw rpcError(grpcStatus.INVALID_ARGUMENT, "payload_must_be_object");
  }

  return parsed as Record<string, unknown>;
}

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function idempotencyPresence(value: unknown): "present" | "absent" {
  return typeof value === "string" && value.trim().length > 0 ? "present" : "absent";
}

function wrapCall(
  method: string,
  handler: UnaryHandler,
  fieldsFor: (request: any, result: any) => CallFields,
): UnaryHandler {
  return async (request: any) => {
    const started = performance.now();

    try {
      const result = await handler(request);
      log.info("grpc call", {
        method,
        duration_ms: Math.round(performance.now() - started),
        code: statusName(grpcStatus.OK),
        ...fieldsFor(request, result),
      });
      return result;
    } catch (error) {
      const code = error instanceof RpcError ? error.code : grpcStatus.INTERNAL;
      const fields = {
        method,
        duration_ms: Math.round(performance.now() - started),
        code: statusName(code),
        ...fieldsFor(request, undefined),
      };

      if (error instanceof RpcError) {
        log.warn("grpc call failed", { ...fields, error: error.message });
      } else {
        log.error("grpc call failed", { ...fields, err: error });
      }

      throw error;
    }
  };
}

export function createLedgerHandlers(
  db: LedgerDatabase,
): Record<string, UnaryHandler> {
  return {
    AppendEvent: wrapCall(
      "AppendEvent",
      (request: AppendEventRequest) => {
        const transactionId = requireString(request.transaction_id, "transaction_id");
        const type = requireString(request.type, "type", 100);
        const payloadJson = requireString(request.payload_json, "payload_json", MAX_PAYLOAD_BYTES);
        const payload = parsePayload(payloadJson);

        if (type === TRANSACTION_CREATED) {
          const created = parseCreatedPayload(payload);
          if (!created) {
            throw rpcError(grpcStatus.INVALID_ARGUMENT, "invalid_created_payload");
          }
        }

        const existingCount = countEvents(db, transactionId);

        const idempotencyKey = request.idempotency_key?.trim();
        if (idempotencyKey && idempotencyKey.length > 0) {
          const replayed = findEventByIdempotencyKey(db, idempotencyKey);
          if (replayed) {
            return { event: replayed, duplicate: true };
          }
        }

        if (type === TRANSACTION_CREATED && existingCount > 0) {
          throw rpcError(grpcStatus.FAILED_PRECONDITION, "transaction_already_exists");
        }

        if (type !== TRANSACTION_CREATED && existingCount === 0) {
          throw rpcError(grpcStatus.FAILED_PRECONDITION, "transaction_not_found");
        }

        const result = appendEvent(db, {
          transaction_id: transactionId,
          type,
          payload_json: payloadJson,
          idempotency_key: request.idempotency_key,
        });

        return { event: result.event, duplicate: result.duplicate };
      },
      (request, result) => ({
        transaction_id: stringField(request?.transaction_id),
        type: stringField(request?.type),
        sequence: result?.event?.sequence,
        duplicate: result?.duplicate,
        idempotency_key: idempotencyPresence(request?.idempotency_key),
      }),
    ),

    GetTransaction: wrapCall(
      "GetTransaction",
      (request: GetTransactionRequest) => {
        const transactionId = requireString(request.transaction_id, "transaction_id");
        const transaction = getTransaction(db, transactionId);

        if (!transaction) {
          throw rpcError(grpcStatus.NOT_FOUND, "transaction_not_found");
        }

        return { transaction };
      },
      (request, result) => ({
        transaction_id: stringField(request?.transaction_id),
        found: result?.transaction != null,
        status: result?.transaction?.status,
      }),
    ),

    FindActiveTransaction: wrapCall(
      "FindActiveTransaction",
      (request: FindActiveTransactionRequest) => {
        const reference = requireString(request.reference, "reference");
        const transaction = findActiveTransaction(db, reference);

        return { transaction };
      },
      (request, result) => ({
        reference: stringField(request?.reference),
        found: result?.transaction != null,
      }),
    ),

    ListEvents: wrapCall(
      "ListEvents",
      (request: ListEventsRequest) => {
        const transactionId = requireString(request.transaction_id, "transaction_id");
        return { events: listEvents(db, transactionId) };
      },
      (request, result) => ({
        transaction_id: stringField(request?.transaction_id),
        count: Array.isArray(result?.events) ? result.events.length : undefined,
      }),
    ),
  };
}
