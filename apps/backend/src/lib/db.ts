/**
 * Backend DB handle. Opens the @stride/db SQLite database once (memoized in the
 * package), gated on the env that the encrypted token store needs.
 *
 *   STRIDE_DB_PATH   where the SQLite file lives (default ./stride.db)
 *   TOKEN_ENC_KEY    32-byte AES-256-GCM key (64 hex or base64) — required to
 *                    read/write provider tokens. Absent ⇒ DB token custody off
 *                    and we fall back to the cookie store (dev convenience).
 */
import { getDb, type StrideDb } from "@stride/db";

let _db: StrideDb | null = null;

/** True when the encrypted DB token store can be used. */
export const dbTokenCustody = !!process.env.TOKEN_ENC_KEY;

export function db(): StrideDb {
  if (!_db) _db = getDb(process.env.STRIDE_DB_PATH);
  return _db;
}
