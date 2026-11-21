import { and, asc, desc, eq, sql } from "drizzle-orm";
import {
  foldTransaction,
  isTransactionActive,
  TRANSACTION_CREATED,
  type LedgerEvent,
  type Transaction,
} from "@diso-pay/contracts";
import type { LedgerDatabase } from "./db/index.ts";
import { events, type EventRow } from "./db/schema.ts";

export function toLedgerEvent(row: EventRow): LedgerEvent {
  return {
    id: row.id,
    transaction_id: row.transactionId,
    sequence: row.sequence,
    type: row.type,
    payload_json: row.payload,
    idempotency_key: row.idempotencyKey ?? "",
    created_at: row.createdAt,
  };
}

export type AppendEventInput = {
  transaction_id: string;
  type: string;
  payload_json: string;
  idempotency_key?: string;
};

export function appendEvent(
  db: LedgerDatabase,
  input: AppendEventInput,
): { event: LedgerEvent; duplicate: boolean } {
  const idempotencyKey = input.idempotency_key?.trim();
  const normalized = idempotencyKey && idempotencyKey.length > 0 ? idempotencyKey : null;

  return db.transaction((tx) => {
    if (normalized) {
      const existing = tx
        .select()
        .from(events)
        .where(eq(events.idempotencyKey, normalized))
        .get();

      if (existing) {
        return { event: toLedgerEvent(existing), duplicate: true };
      }
    }

    const row = tx
      .select({
        next: sql<number>`coalesce(max(${events.sequence}), 0) + 1`,
      })
      .from(events)
      .where(eq(events.transactionId, input.transaction_id))
      .get();

    const inserted = tx
      .insert(events)
      .values({
        transactionId: input.transaction_id,
        sequence: row?.next ?? 1,
        type: input.type,
        payload: input.payload_json,
        idempotencyKey: normalized,
        createdAt: Date.now(),
      })
      .returning()
      .get();

    if (!inserted) throw new Error("ledger_insert_failed");

    return { event: toLedgerEvent(inserted), duplicate: false };
  });
}

export function findEventByIdempotencyKey(
  db: LedgerDatabase,
  idempotencyKey: string,
): LedgerEvent | null {
  const row = db
    .select()
    .from(events)
    .where(eq(events.idempotencyKey, idempotencyKey))
    .get();

  return row ? toLedgerEvent(row) : null;
}

export function countEvents(db: LedgerDatabase, transactionId: string): number {
  const row = db
    .select({ value: sql<number>`count(*)` })
    .from(events)
    .where(eq(events.transactionId, transactionId))
    .get();

  return row?.value ?? 0;
}

export function listEvents(
  db: LedgerDatabase,
  transactionId: string,
): LedgerEvent[] {
  return db
    .select()
    .from(events)
    .where(eq(events.transactionId, transactionId))
    .orderBy(asc(events.sequence))
    .all()
    .map(toLedgerEvent);
}

export function getTransaction(
  db: LedgerDatabase,
  transactionId: string,
  now = Date.now(),
): Transaction | null {
  return foldTransaction(listEvents(db, transactionId), now);
}

function transactionIdsForReference(
  db: LedgerDatabase,
  reference: string,
): string[] {
  return db
    .select({ transactionId: events.transactionId })
    .from(events)
    .where(
      and(
        eq(events.type, TRANSACTION_CREATED),
        sql`json_extract(${events.payload}, '$.reference') = ${reference}`,
      ),
    )
    .orderBy(desc(events.id))
    .all()
    .map((row) => row.transactionId);
}

export function findTransactionByReference(
  db: LedgerDatabase,
  reference: string,
  now = Date.now(),
): Transaction | null {
  const transactionId = transactionIdsForReference(db, reference)[0];
  if (!transactionId) return null;

  return getTransaction(db, transactionId, now);
}

export function findActiveTransaction(
  db: LedgerDatabase,
  reference: string,
  now = Date.now(),
): Transaction | null {
  const rows = transactionIdsForReference(db, reference).map((transactionId) => ({
    transactionId,
  }));

  const seen = new Set<string>();

  for (const row of rows) {
    if (seen.has(row.transactionId)) continue;
    seen.add(row.transactionId);

    const transaction = getTransaction(db, row.transactionId, now);
    if (transaction && isTransactionActive(transaction, now)) {
      return transaction;
    }
  }

  return null;
}
