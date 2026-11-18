import {
  LEDGER_PROTO,
  PAYMENT_PROTO,
  type LedgerClient,
  type PaymentClient,
} from "@diso-pay/contracts";
import { createGrpcClient, type GrpcClientHandle } from "@diso-pay/grpc";

type ClientStore = {
  ledger?: GrpcClientHandle<LedgerClient>;
  payment?: GrpcClientHandle<PaymentClient>;
};

const STORE_KEY = Symbol.for("diso-pay.processor.grpc");

function store(): ClientStore {
  const global = globalThis as typeof globalThis & { [STORE_KEY]?: ClientStore };
  global[STORE_KEY] ??= {};
  return global[STORE_KEY];
}

export function ledgerClient(): LedgerClient {
  const clients = store();
  clients.ledger ??= createGrpcClient<LedgerClient>(
    LEDGER_PROTO,
    process.env.LEDGER_GRPC_ADDRESS ?? "127.0.0.1:50051",
  );
  return clients.ledger.client;
}

export function paymentClient(): PaymentClient {
  const clients = store();
  clients.payment ??= createGrpcClient<PaymentClient>(
    PAYMENT_PROTO,
    process.env.PAYMENT_GRPC_ADDRESS ?? "127.0.0.1:50052",
  );
  return clients.payment.client;
}
