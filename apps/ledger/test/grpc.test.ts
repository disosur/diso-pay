import { expect, test } from "bun:test";
import {
  CHECKOUT_SESSION_CREATED,
  TRANSACTION_CREATED,
  parseCreatedPayload,
  type LedgerClient,
} from "@diso-pay/contracts";
import {
  createGrpcClient,
  createGrpcServer,
  isRpcCode,
  listen,
  registerService,
  status,
} from "@diso-pay/grpc";
import { LEDGER_PROTO } from "@diso-pay/contracts";
import { openDatabase } from "../src/db/index.ts";
import { createLedgerHandlers } from "../src/grpc.ts";

const TRANSACTION_ID = `txn_${"a".repeat(32)}`;
const MISSING_ID = `txn_${"b".repeat(32)}`;

test("ledger gRPC round trip", async () => {
  const { db, sqlite } = openDatabase(":memory:");
  const server = createGrpcServer();
  registerService(server, LEDGER_PROTO, createLedgerHandlers(db));

  const port = await listen(server, "127.0.0.1:0");
  const { client, close } = createGrpcClient<LedgerClient>(
    LEDGER_PROTO,
    `127.0.0.1:${port}`,
  );

  const now = Date.now();
  const createdPayload = {
    currency: "PHP",
    amount_total: 50_000,
    line_items: [{ name: "Item 1", amount: 50_000, quantity: 1 }],
    success_url: "https://merchant.test/ok",
    cancel_url: "https://merchant.test/cancel",
    reference: "order_roundtrip",
    payment_method: "gcash",
    metadata: { order_id: "order_roundtrip" },
    expires_at: now + 600_000,
  };

  try {
    expect(parseCreatedPayload(createdPayload)).not.toBeNull();

    const appended = await client.AppendEvent({
      transaction_id: TRANSACTION_ID,
      type: TRANSACTION_CREATED,
      payload_json: JSON.stringify(createdPayload),
      idempotency_key: "created:1",
    });

    expect(appended.duplicate).toBe(false);
    expect(appended.event.sequence).toBe(1);

    const duplicate = await client.AppendEvent({
      transaction_id: TRANSACTION_ID,
      type: TRANSACTION_CREATED,
      payload_json: JSON.stringify(createdPayload),
      idempotency_key: "created:1",
    });

    expect(duplicate.duplicate).toBe(true);

    const created = await client.GetTransaction({ transaction_id: TRANSACTION_ID });
    expect(created.transaction.status).toBe("pending");
    expect(created.transaction.amount_total).toBe(50_000);
    expect(created.transaction.metadata.order_id).toBe("order_roundtrip");
    expect(created.transaction.payment_method).toBe("gcash");

    const active = await client.FindActiveTransaction({ reference: "order_roundtrip" });
    expect(active.transaction?.id).toBe(TRANSACTION_ID);

    await client.AppendEvent({
      transaction_id: TRANSACTION_ID,
      type: CHECKOUT_SESSION_CREATED,
      payload_json: JSON.stringify({
        provider: "payrex",
        method: "gcash",
        currency: "PHP",
        amount: 50_000,
        provider_session_id: "cs_test_1",
        url: "https://pay.test/cs_test_1",
        expires_at: now + 600_000,
      }),
      idempotency_key: "session:1",
    });

    const awaiting = await client.GetTransaction({ transaction_id: TRANSACTION_ID });
    expect(awaiting.transaction.status).toBe("awaiting_payment");
    expect(awaiting.transaction.sessions).toHaveLength(1);
    expect(awaiting.transaction.sessions[0]?.url).toBe("https://pay.test/cs_test_1");

    const events = await client.ListEvents({ transaction_id: TRANSACTION_ID });
    expect(events.events.map((event) => event.sequence)).toEqual([1, 2]);

    const notFound = await client
      .GetTransaction({ transaction_id: MISSING_ID })
      .catch((error: unknown) => error);

    expect(isRpcCode(notFound, status.NOT_FOUND)).toBe(true);
  } finally {
    close();
    server.forceShutdown();
    sqlite.close();
  }
});
