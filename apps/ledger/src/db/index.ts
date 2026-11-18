import { Database } from "bun:sqlite";
import { drizzle } from "drizzle-orm/bun-sqlite";
import { migrate } from "drizzle-orm/bun-sqlite/migrator";
import * as schema from "./schema.ts";

export type LedgerDatabase = ReturnType<typeof openDatabase>["db"];

export function openDatabase(
  path: string,
  options: { migrate?: boolean } = {},
) {
  const sqlite = new Database(path, { create: true });
  sqlite.run("PRAGMA journal_mode = WAL");
  sqlite.run("PRAGMA synchronous = NORMAL");
  sqlite.run("PRAGMA busy_timeout = 5000");

  const db = drizzle(sqlite, { schema });

  if (options.migrate ?? true) {
    migrate(db, { migrationsFolder: migrationsFolder() });
  }

  return { db, sqlite };
}

export function migrationsFolder(): string {
  return new URL("../../drizzle", import.meta.url).pathname;
}
