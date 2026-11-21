import { Hono } from "hono";
import {
  foldTransaction,
  type Transaction,
  type TransactionStatus,
} from "@diso-pay/contracts";
import type { LedgerDatabase } from "./db/index.ts";
import {
  findActiveTransaction,
  findTransactionByReference,
  getTransaction,
  listEvents,
} from "./repository.ts";

type StatusHistoryEntry = {
  sequence: number | null;
  type: string;
  status: TransactionStatus;
  created_at: number;
  at: string;
  payload: unknown;
  derived?: boolean;
};

function parseEventPayload(json: string): unknown {
  try {
    return JSON.parse(json);
  } catch {
    return null;
  }
}

function buildStatusHistory(
  db: LedgerDatabase,
  transaction: Transaction,
): StatusHistoryEntry[] {
  const events = listEvents(db, transaction.id);

  const history: StatusHistoryEntry[] = events.map((event, index) => {
    const folded = foldTransaction(events.slice(0, index + 1), event.created_at);

    return {
      sequence: event.sequence,
      type: event.type,
      status: folded?.status ?? transaction.status,
      created_at: event.created_at,
      at: new Date(event.created_at).toISOString(),
      payload: parseEventPayload(event.payload_json),
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
      payload: null,
      derived: true,
    });
  }

  return history;
}

function statusResponse(db: LedgerDatabase, transaction: Transaction) {
  return {
    transaction,
    status_history: buildStatusHistory(db, transaction),
  };
}

export function createHttpApp(db: LedgerDatabase): Hono {
  const app = new Hono();

  app.get("/", (c) => c.json({ name: "diso-pay-ledger", status: "ok" }));

  app.get("/health", (c) =>
    c.json({
      status: "ok",
      uptime: process.uptime(),
      timestamp: new Date().toISOString(),
    }),
  );

  app.get("/transactions", (c) => {
    const reference = c.req.query("reference");
    if (!reference) {
      return c.json({ error: "missing_reference" }, 400);
    }

    const transaction = findActiveTransaction(db, reference);
    if (!transaction) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json({ transaction });
  });

  app.get("/transactions/by-reference/:reference/status", (c) => {
    const transaction = findTransactionByReference(db, c.req.param("reference"));
    if (!transaction) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json(statusResponse(db, transaction));
  });

  app.get("/transactions/:id", (c) => {
    const transaction = getTransaction(db, c.req.param("id"));
    if (!transaction) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json({ transaction });
  });

  app.get("/transactions/:id/events", (c) => {
    return c.json({ events: listEvents(db, c.req.param("id")) });
  });

  app.get("/transactions/:id/status", (c) => {
    const transaction = getTransaction(db, c.req.param("id"));
    if (!transaction) {
      return c.json({ error: "not_found" }, 404);
    }

    return c.json(statusResponse(db, transaction));
  });

  return app;
}
