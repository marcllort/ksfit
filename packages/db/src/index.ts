/**
 * @stride/db — Drizzle SQLite layer for Stride.
 *
 * SQLite via better-sqlite3, schema kept Postgres-portable. Open a DB with
 * getDb() and build typed repos over it:
 *
 *   import { getDb, tokensRepo, sessionsRepo } from "@stride/db";
 *   const db = getDb();
 *   const tokens = tokensRepo(db);
 *
 * See docs/architecture/03-DATA-MODEL.md for the entities and the
 * raw → cached → derived metric pipeline these tables back.
 */

export { getDb, closeDb, BOOTSTRAP_DDL, type StrideDb } from "./client";
export * as schema from "./schema";
export * from "./repos";
