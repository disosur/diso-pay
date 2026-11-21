import { afterAll, expect, test } from "bun:test";
import {
  CHECKOUT_SESSION_CREATED,
  PAYMENT_SUCCEEDED,
  TRANSACTION_CREATED,
  type CreatedPayload,
  type SessionPayload,
} from "@diso-pay/contracts";
import { openDatabase } from "../src/db/index.ts";
import { createHttpApp } from "../src/http.ts";
import { appendEvent } from "../src/repository.ts";

const { db, sqlite } = openDatabase(":memory:");
const app = createHttpApp(db);

function transactionId(char: string): string {
  return `txn_${char.repeat(32)}`;
}

function seed(
  id: string,
  status: "pending" | "completed" | "expired",
  reference: string,
) {
  const now = Date.now();
  const created: CreatedPayload = {
    currency: "PHP",
    amount_total: 25_000,
    line_items: [{ name: "Item", amount: 25_000, quantity: 1 }],
    success_url: "https://merchant.test/ok",
    cancel_url: "https://merchant.test/cancel",
    reference,
    expires_at: status === "expired" ? now - 60_000 : now + 600_000,
  };

  appendEvent(db, {
    transaction_id: id,
    type: TRANSACTION_CREATED,
    payload_json: JSON.stringify(created),
    idempotency_key: `created:${id}`,
  });

  if (status === "pending") return;

  const session: SessionPayload = {
    provider: "stripe",
    method: "card",
    currency: "PHP",
    amount: 25_000,
    provider_session_id: `cs_${id}`,
    url: "https://checkout.stripe.test/session",
    expires_at: now + 600_000,
  };

  appendEvent(db, {
    transaction_id: id,
    type: CHECKOUT_SESSION_CREATED,
    payload_json: JSON.stringify(session),
    idempotency_key: `session:${id}`,
  });

  if (status === "completed") {
    appendEvent(db, {
      transaction_id: id,
      type: PAYMENT_SUCCEEDED,
      payload_json: JSON.stringify({
        provider: "stripe",
        provider_session_id: session.provider_session_id,
      }),
      idempotency_key: `succeeded:${id}`,
    });
  }
}

afterAll(() => {
  sqlite.close();
});

test("status route returns folded status and status history by transaction id", async () => {
  const id = transactionId("c");
  seed(id, "completed", "order_completed");

  const response = await app.request(`/transactions/${id}/status`);
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    transaction: { status: string; reference: string };
    status_history: { type: string; status: string }[];
  };

  expect(body.transaction.status).toBe("completed");
  expect(body.transaction.reference).toBe("order_completed");
  expect(body.status_history.map((entry) => entry.type)).toEqual([
    TRANSACTION_CREATED,
    CHECKOUT_SESSION_CREATED,
    PAYMENT_SUCCEEDED,
  ]);
  expect(body.status_history.map((entry) => entry.status)).toEqual([
    "pending",
    "awaiting_payment",
    "completed",
  ]);
});

test("status route resolves the latest transaction by reference", async () => {
  const id = transactionId("d");
  seed(id, "pending", "order_pending");

  const response = await app.request(
    "/transactions/by-reference/order_pending/status",
  );
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    transaction: { id: string; status: string };
    status_history: { status: string }[];
  };

  expect(body.transaction.id).toBe(id);
  expect(body.transaction.status).toBe("pending");
  expect(body.status_history).toHaveLength(1);
});

test("status history marks expired transactions as derived", async () => {
  const id = transactionId("e");
  seed(id, "expired", "order_expired");

  sqlite.run("UPDATE events SET created_at = ? WHERE transaction_id = ?", [
    Date.now() - 120_000,
    id,
  ]);

  const response = await app.request(`/transactions/${id}/status`);
  expect(response.status).toBe(200);

  const body = (await response.json()) as {
    transaction: { status: string };
    status_history: { type: string; status: string; derived?: boolean }[];
  };

  expect(body.transaction.status).toBe("expired");
  expect(body.status_history.at(-1)).toMatchObject({
    type: "transaction.expired",
    status: "expired",
    derived: true,
  });
});

test("status route returns 404 for unknown transactions and references", async () => {
  const byId = await app.request(
    `/transactions/txn_${"f".repeat(32)}/status`,
  );
  expect(byId.status).toBe(404);

  const byReference = await app.request(
    "/transactions/by-reference/order_missing/status",
  );
  expect(byReference.status).toBe(404);
});
