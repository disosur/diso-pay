import { LEDGER_PROTO_SOURCE } from "./ledger.ts";
import { PAYMENT_PROTO_SOURCE } from "./payment.ts";

export type ProtoDescriptor = {
  source: string;
  package: string;
  service: string;
};

export const LEDGER_PROTO: ProtoDescriptor = {
  source: LEDGER_PROTO_SOURCE,
  package: "disopay.ledger.v1",
  service: "LedgerService",
};

export const PAYMENT_PROTO: ProtoDescriptor = {
  source: PAYMENT_PROTO_SOURCE,
  package: "disopay.payment.v1",
  service: "PaymentService",
};

export { LEDGER_PROTO_SOURCE, PAYMENT_PROTO_SOURCE };
