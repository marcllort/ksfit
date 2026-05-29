/**
 * better-sqlite3 + Drizzle client.
 *
 * getDb() opens the database at process.env.STRIDE_DB_PATH (default "./stride.db"),
 * applies an idempotent CREATE TABLE IF NOT EXISTS bootstrap on first open, and
 * returns a memoized Drizzle instance. Re-opening an existing file is a no-op;
 * drizzle-kit migrations remain the preferred path for CI / the Postgres move,
 * but the self-hosted single-file deploy needs zero-ops auto-bootstrap.
 */

import Database from "better-sqlite3";
import { drizzle, type BetterSQLite3Database } from "drizzle-orm/better-sqlite3";

import { BOOTSTRAP_DDL } from "./bootstrap";
import * as schema from "./schema";

export type StrideDb = BetterSQLite3Database<typeof schema>;

const DEFAULT_DB_PATH = "./stride.db";

interface DbHandle {
  db: StrideDb;
  sqlite: Database.Database;
  path: string;
}

let handle: DbHandle | null = null;

/**
 * Open (or return the memoized) Drizzle database.
 * @param dbPath override the path; defaults to STRIDE_DB_PATH ?? "./stride.db".
 */
export function getDb(dbPath?: string): StrideDb {
  const target = dbPath ?? process.env.STRIDE_DB_PATH ?? DEFAULT_DB_PATH;

  if (handle && handle.path === target) {
    return handle.db;
  }

  // A different path was requested (e.g. tests): close the previous handle.
  if (handle) {
    handle.sqlite.close();
    handle = null;
  }

  const sqlite = new Database(target);
  // WAL + foreign keys: durable, concurrent reads, referential integrity.
  sqlite.pragma("journal_mode = WAL");
  sqlite.pragma("foreign_keys = ON");
  // Idempotent bootstrap; .exec runs the multi-statement DDL.
  sqlite.exec(BOOTSTRAP_DDL);

  const db = drizzle(sqlite, { schema });
  handle = { db, sqlite, path: target };
  return db;
}

/** Close the memoized connection (useful for tests / graceful shutdown). */
export function closeDb(): void {
  if (handle) {
    handle.sqlite.close();
    handle = null;
  }
}

export { BOOTSTRAP_DDL };
