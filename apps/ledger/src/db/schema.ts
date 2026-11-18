import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const events = sqliteTable(
  "events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    transactionId: text("transaction_id").notNull(),
    sequence: integer("sequence").notNull(),
    type: text("type").notNull(),
    payload: text("payload").notNull(),
    idempotencyKey: text("idempotency_key"),
    createdAt: integer("created_at").notNull(),
  },
  (table) => [
    uniqueIndex("events_transaction_sequence_unique").on(
      table.transactionId,
      table.sequence,
    ),
    uniqueIndex("events_idempotency_key_unique").on(table.idempotencyKey),
    index("events_transaction_id_index").on(table.transactionId),
    index("events_type_index").on(table.type),
  ],
);

export type EventRow = typeof events.$inferSelect;
export type NewEventRow = typeof events.$inferInsert;
