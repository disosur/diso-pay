import { Hono } from "hono";
import type { LedgerDatabase } from "./db/index.ts";
import { findActiveTransaction, getTransaction, listEvents } from "./repository.ts";

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

  return app;
}
