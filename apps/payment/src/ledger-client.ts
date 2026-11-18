import { LEDGER_PROTO, type LedgerClient } from "@diso-pay/contracts";
import { createGrpcClient, type GrpcClientHandle } from "@diso-pay/grpc";

export function createLedgerClient(address: string): GrpcClientHandle<LedgerClient> {
  return createGrpcClient<LedgerClient>(LEDGER_PROTO, address);
}
