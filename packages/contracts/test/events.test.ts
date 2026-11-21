import { describe, expect, test } from "bun:test";
import {
  CHECKOUT_RETURNED,
  CHECKOUT_SESSION_CREATED,
  CHECKOUT_SESSION_REUSED,
  findReusableSession,
  foldTransaction,
  isTransactionActive,
  parseCreatedPayload,
  PAYMENT_SUCCEEDED,
  TRANSACTION_CREATED,
  type CreatedPayload,
  type LedgerEvent,
  type PaymentSucceededPayload,
  type SessionPayload,
} from "../src/index.ts";

const NOW = 1_900_000_000_000;

const created: CreatedPayload = {
  currency: "PHP",
  amount_total: 50_000,
  line_items: [{ name: "Item", amount: 50_000, quantity: 1 }],
  success_url: "https://merchant.test/ok",
  cancel_url: "https://merchant.test/cancel",
  reference: "order_1",
  metadata: { order_id: "order_1" },
  expires_at: NOW + 60_000,
};

const session: SessionPayload = {
  provider: "xendit",
  method: "gcash",
  currency: "PHP",
  amount: 50_000,
  provider_session_id: "cs_test_1",
  url: "https://pay.test/cs_test_1",
  expires_at: NOW + 60_000,
};

function event(
  sequence: number,
  type: string,
  payload: unknown,
  createdAt = NOW,
): LedgerEvent {
  return {
    id: sequence,
    transaction_id: `txn_${"a".repeat(32)}`,
    sequence,
    type,
    payload_json: JSON.stringify(payload),
    idempotency_key: "",
    created_at: createdAt,
  };
}

describe("foldTransaction", () => {
  test("returns null without a created event", () => {
    expect(foldTransaction([], NOW)).toBeNull();
    expect(foldTransaction([event(1, CHECKOUT_RETURNED, {})], NOW)).toBeNull();
  });

  test("folds a pending transaction", () => {
    const transaction = foldTransaction([event(1, TRANSACTION_CREATED, created)], NOW);

    expect(transaction).not.toBeNull();
    expect(transaction?.id).toBe(`txn_${"a".repeat(32)}`);
    expect(transaction?.status).toBe("pending");
    expect(transaction?.amount_total).toBe(50_000);
    expect(transaction?.reference).toBe("order_1");
    expect(transaction?.metadata).toEqual({ order_id: "order_1" });
  });

  test("moves to awaiting_payment once a session exists", () => {
    const transaction = foldTransaction(
      [
        event(1, TRANSACTION_CREATED, created),
        event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
      ],
      NOW + 2_000,
    );

    expect(transaction?.status).toBe("awaiting_payment");
    expect(transaction?.sessions).toHaveLength(1);
    expect(transaction?.sessions[0]?.url).toBe(session.url);
  });

  test("dedupes reused sessions by provider session id", () => {
    const transaction = foldTransaction(
      [
        event(1, TRANSACTION_CREATED, created),
        event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
        event(3, CHECKOUT_SESSION_REUSED, session, NOW + 2_000),
      ],
      NOW + 3_000,
    );

    expect(transaction?.sessions).toHaveLength(1);
  });

  test("completes on a successful return", () => {
    const transaction = foldTransaction(
      [
        event(1, TRANSACTION_CREATED, created),
        event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
        event(
          3,
          CHECKOUT_RETURNED,
          { outcome: "success", provider: "xendit", method: "gcash" },
          NOW + 2_000,
        ),
      ],
      NOW + 3_000,
    );

    expect(transaction?.status).toBe("completed");
    expect(transaction?.last_outcome).toBe("success");
    expect(isTransactionActive(transaction!, NOW + 3_000)).toBe(false);
  });

  test("completes when the provider reports a successful payment", () => {
    const payment: PaymentSucceededPayload = {
      provider: "xendit",
      provider_session_id: "ps_test_1",
      amount: 50_000,
      currency: "PHP",
      reference: "order_1",
    };

    const transaction = foldTransaction(
      [
        event(1, TRANSACTION_CREATED, created),
        event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
        event(3, PAYMENT_SUCCEEDED, payment, NOW + 2_000),
      ],
      NOW + 3_000,
    );

    expect(transaction?.status).toBe("completed");
    expect(transaction?.last_outcome).toBe("success");
    expect(isTransactionActive(transaction!, NOW + 3_000)).toBe(false);
  });

  test("keeps a reported payment terminal when a later cancel returns", () => {
    const payment: PaymentSucceededPayload = {
      provider: "stripe",
      provider_session_id: "cs_test_1",
    };

    const transaction = foldTransaction(
      [
        event(1, TRANSACTION_CREATED, created),
        event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
        event(3, PAYMENT_SUCCEEDED, payment, NOW + 2_000),
        event(
          4,
          CHECKOUT_RETURNED,
          { outcome: "cancel", provider: "stripe", method: "card" },
          NOW + 3_000,
        ),
      ],
      NOW + 4_000,
    );

    expect(transaction?.status).toBe("completed");
    expect(transaction?.last_outcome).toBe("success");
  });

  test("keeps a success terminal when a later cancel returns", () => {
    const transaction = foldTransaction(
      [
        event(1, TRANSACTION_CREATED, created),
        event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
        event(
          3,
          CHECKOUT_RETURNED,
          { outcome: "success", provider: "xendit", method: "gcash" },
          NOW + 2_000,
        ),
        event(
          4,
          CHECKOUT_RETURNED,
          { outcome: "cancel", provider: "xendit", method: "gcash" },
          NOW + 3_000,
        ),
      ],
      NOW + 4_000,
    );

    expect(transaction?.status).toBe("completed");
    expect(transaction?.last_outcome).toBe("success");
  });

  test("expires after the deadline", () => {
    const transaction = foldTransaction(
      [event(1, TRANSACTION_CREATED, created)],
      NOW + 60_001,
    );

    expect(transaction?.status).toBe("expired");
    expect(isTransactionActive(transaction!, NOW + 60_001)).toBe(false);
  });
});

describe("payment method lock", () => {
  test("folds the locked payment method", () => {
    const transaction = foldTransaction(
      [event(1, TRANSACTION_CREATED, { ...created, payment_method: "gcash" })],
      NOW,
    );

    expect(transaction?.payment_method).toBe("gcash");
  });

  test("defaults to an empty method when the link is unlocked", () => {
    const transaction = foldTransaction([event(1, TRANSACTION_CREATED, created)], NOW);

    expect(transaction?.payment_method).toBe("");
  });

  test("rejects an unknown payment method in the created payload", () => {
    expect(parseCreatedPayload({ ...created, payment_method: "paypal" })).toBeNull();
  });
});

describe("findReusableSession", () => {
  const transaction = foldTransaction(
    [
      event(1, TRANSACTION_CREATED, created),
      event(2, CHECKOUT_SESSION_CREATED, session, NOW + 1_000),
    ],
    NOW + 1_000,
  )!;

  test("reuses a matching active session", () => {
    const found = findReusableSession(
      transaction,
      { method: "gcash", currency: "PHP", amount: 50_000 },
      NOW + 2_000,
    );

    expect(found?.provider_session_id).toBe("cs_test_1");
  });

  test("ignores other methods, amounts, and expired sessions", () => {
    expect(
      findReusableSession(
        transaction,
        { method: "maya", currency: "PHP", amount: 50_000 },
        NOW + 2_000,
      ),
    ).toBeNull();

    expect(
      findReusableSession(
        transaction,
        { method: "gcash", currency: "PHP", amount: 10_000 },
        NOW + 2_000,
      ),
    ).toBeNull();

    expect(
      findReusableSession(
        transaction,
        { method: "gcash", currency: "PHP", amount: 50_000 },
        NOW + 60_001,
      ),
    ).toBeNull();
  });
});
