import { describe, expect, test } from "bun:test";
import {
  TRANSACTION_CREATED,
  foldTransaction,
  type LedgerClient,
  type LedgerEvent,
  type Transaction,
} from "@diso-pay/contracts";
import { status } from "@diso-pay/grpc";
import type { PaymentConfig } from "../src/config.ts";
import type { ProviderRegistry } from "../src/providers/index.ts";
import { createPaymentService } from "../src/service.ts";

const TRANSACTION_ID = `txn_${"a".repeat(32)}`;
const NOW = Date.now();

const config: PaymentConfig = {
  httpPort: 0,
  grpcAddress: "127.0.0.1:0",
  ledgerAddress: "127.0.0.1:0",
  processorPublicUrl: "http://localhost:3000",
  checkoutReturnBaseUrl: "",
  fxPhpPerUsd: 58,
  transactionTtlSeconds: 1_800,
  stripeSecretKey: "",
  stripeWebhookSecret: "",
  payrexSecretKey: "sk_test",
  payrexWebhookSecret: "",
  payrexApiBaseUrl: "https://api.payrexhq.com",
};

function lockedTransaction(payment_method: "gcash" | "card"): Transaction {
  const created: LedgerEvent = {
    id: 1,
    transaction_id: TRANSACTION_ID,
    sequence: 1,
    type: TRANSACTION_CREATED,
    payload_json: JSON.stringify({
      currency: "PHP",
      amount_total: 50_000,
      line_items: [{ name: "Item", amount: 50_000, quantity: 1 }],
      success_url: "https://merchant.test/ok",
      cancel_url: "https://merchant.test/cancel",
      payment_method,
      expires_at: NOW + 600_000,
    }),
    idempotency_key: "",
    created_at: NOW,
  };

  return foldTransaction([created], NOW)!;
}

function serviceFor(transaction: Transaction) {
  const ledger = {
    GetTransaction: async () => ({ transaction }),
  } as unknown as LedgerClient;

  return createPaymentService({
    config,
    ledger,
    providers: {} as ProviderRegistry,
  });
}

describe("createCheckoutSession payment method lock", () => {
  test("rejects a method the link is not locked to", async () => {
    const service = serviceFor(lockedTransaction("gcash"));

    const error = await service
      .createCheckoutSession({
        transaction_id: TRANSACTION_ID,
        method: "maya",
        currency: "PHP",
      })
      .catch((caught: unknown) => caught);

    expect(error).toMatchObject({
      code: status.INVALID_ARGUMENT,
      message: "payment_method_not_allowed:gcash",
    });
  });
});
