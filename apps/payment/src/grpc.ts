import type {
  CreateCheckoutSessionRequest,
} from "@diso-pay/contracts";
import {
  RpcError,
  status as grpcStatus,
  statusName,
  type UnaryHandler,
} from "@diso-pay/grpc";
import { log } from "./logger.ts";
import type { PaymentService } from "./service.ts";

type CallFields = Record<string, unknown>;

function stringField(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function wrapCall(
  method: string,
  handler: UnaryHandler,
  level: "debug" | "info",
  fieldsFor: (request: any, result: any) => CallFields,
): UnaryHandler {
  return async (request: any) => {
    const started = performance.now();

    try {
      const result = await handler(request);
      log[level]("grpc call", {
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

export function createPaymentHandlers(
  service: PaymentService,
): Record<string, UnaryHandler> {
  return {
    CreateCheckoutSession: wrapCall(
      "CreateCheckoutSession",
      (request: CreateCheckoutSessionRequest) =>
        service.createCheckoutSession(request),
      "info",
      (request, result) => ({
        transaction_id: stringField(request?.transaction_id),
        payment_method: stringField(request?.method),
        requested_currency: stringField(request?.currency),
        currency: stringField(result?.currency),
        provider: stringField(result?.provider),
        amount: result?.amount,
        reused: result?.reused,
      }),
    ),

    GetCheckoutOptions: wrapCall(
      "GetCheckoutOptions",
      () => service.getCheckoutOptions(),
      "debug",
      () => ({}),
    ),
  };
}
