/**
 * provider_accounts repo — server-custodied OAuth tokens, AES-256-GCM encrypted
 * at rest with process.env.TOKEN_ENC_KEY (node:crypto). The plaintext token is
 * never stored; only ciphertext + per-row 12-byte IV + 16-byte GCM auth tag.
 *
 * TOKEN_ENC_KEY must be a 32-byte key supplied as 64 hex chars or base64. Refresh
 * runs off the request path (a cron reads rows nearing expiresAt, refreshes, and
 * writes back via upsert).
 */

import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from "node:crypto";
import { and, eq } from "drizzle-orm";

import type { StrideDb } from "../client";
import { providerAccounts } from "../schema";

const ALGO = "aes-256-gcm";
const IV_BYTES = 12;
const TAG_BYTES = 16;

export interface TokenSecrets {
  accessToken: string;
  /** Some providers omit a refresh token on certain grants. */
  refreshToken?: string | null;
}

export interface UpsertTokenInput extends TokenSecrets {
  id: string;
  userId: string;
  provider: string;
  providerUserId?: string | null;
  /** Epoch ms the access token expires; cron refreshes before this. */
  expiresAt?: number | null;
  scope?: string | null;
}

export interface DecryptedAccount {
  id: string;
  userId: string;
  provider: string;
  providerUserId: string | null;
  accessToken: string;
  refreshToken: string | null;
  expiresAt: number | null;
  scope: string | null;
  connectedAt: number;
  updatedAt: number;
}

function loadKey(): Buffer {
  const raw = process.env.TOKEN_ENC_KEY;
  if (!raw) {
    throw new Error(
      "TOKEN_ENC_KEY is not set; required to encrypt provider tokens at rest",
    );
  }
  // Accept 64 hex chars or base64; both must decode to 32 bytes.
  const key = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, "hex")
    : Buffer.from(raw, "base64");
  if (key.length !== 32) {
    throw new Error(
      `TOKEN_ENC_KEY must decode to 32 bytes for ${ALGO}; got ${key.length}`,
    );
  }
  return key;
}

interface SealedField {
  iv: Buffer;
  tag: Buffer;
  ciphertext: Buffer;
}

/**
 * Encrypt one field with a FRESH per-field IV — GCM nonces must never be reused
 * under the same key, so access and refresh tokens each get their own.
 */
function sealField(plaintext: string): SealedField {
  const key = loadKey();
  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(ALGO, key, iv);
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, "utf8"),
    cipher.final(),
  ]);
  return { iv, tag: cipher.getAuthTag(), ciphertext };
}

function openField(iv: Buffer, tag: Buffer, ciphertext: Buffer): string {
  const key = loadKey();
  const decipher = createDecipheriv(ALGO, key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([
    decipher.update(ciphertext),
    decipher.final(),
  ]).toString("utf8");
}

/** Self-describing blob layout: iv(12) || tag(16) || ciphertext. */
function packField(f: SealedField): Buffer {
  return Buffer.concat([f.iv, f.tag, f.ciphertext]);
}
function unpackField(blob: Buffer): SealedField {
  return {
    iv: blob.subarray(0, IV_BYTES),
    tag: blob.subarray(IV_BYTES, IV_BYTES + TAG_BYTES),
    ciphertext: blob.subarray(IV_BYTES + TAG_BYTES),
  };
}

function toBuf(v: unknown): Buffer {
  // better-sqlite3 returns blobs as Buffer/Uint8Array depending on driver path.
  if (Buffer.isBuffer(v)) return v;
  if (v instanceof Uint8Array) return Buffer.from(v);
  throw new Error("expected a blob column to be Buffer/Uint8Array");
}

export function tokensRepo(db: StrideDb) {
  return {
    /** Insert or update the (user, provider) account, encrypting tokens. */
    upsert(input: UpsertTokenInput): void {
      // Each field is sealed under its own fresh IV (no GCM nonce reuse). The
      // access token's iv/tag live in the dedicated enc_iv/enc_tag columns; the
      // refresh token is a fully self-describing blob: iv(12)||tag(16)||cipher.
      const access = sealField(input.accessToken);
      const refreshBlob =
        input.refreshToken != null
          ? packField(sealField(input.refreshToken))
          : null;
      const now = Date.now();

      const set = {
        providerUserId: input.providerUserId ?? null,
        accessTokenEnc: access.ciphertext,
        refreshTokenEnc: refreshBlob,
        encIv: access.iv,
        encTag: access.tag,
        expiresAt: input.expiresAt ?? null,
        scope: input.scope ?? null,
        updatedAt: now,
      };

      db.insert(providerAccounts)
        .values({
          id: input.id,
          userId: input.userId,
          provider: input.provider,
          connectedAt: now,
          ...set,
        })
        .onConflictDoUpdate({
          target: [providerAccounts.userId, providerAccounts.provider],
          set,
        })
        .run();
    },

    /** Fetch + decrypt the account for (user, provider), or null. */
    get(userId: string, provider: string): DecryptedAccount | null {
      const row = db
        .select()
        .from(providerAccounts)
        .where(
          and(
            eq(providerAccounts.userId, userId),
            eq(providerAccounts.provider, provider),
          ),
        )
        .get();
      if (!row) return null;

      const accessToken = openField(
        toBuf(row.encIv),
        toBuf(row.encTag),
        toBuf(row.accessTokenEnc),
      );

      let refreshToken: string | null = null;
      if (row.refreshTokenEnc != null) {
        const f = unpackField(toBuf(row.refreshTokenEnc));
        refreshToken = openField(f.iv, f.tag, f.ciphertext);
      }

      return {
        id: row.id,
        userId: row.userId,
        provider: row.provider,
        providerUserId: row.providerUserId ?? null,
        accessToken,
        refreshToken,
        expiresAt: row.expiresAt ?? null,
        scope: row.scope ?? null,
        connectedAt: row.connectedAt,
        updatedAt: row.updatedAt,
      };
    },

    /** Cheap connectivity check: does a (user, provider) row exist? */
    exists(userId: string, provider: string): boolean {
      return (
        db
          .select({ id: providerAccounts.id })
          .from(providerAccounts)
          .where(
            and(
              eq(providerAccounts.userId, userId),
              eq(providerAccounts.provider, provider),
            ),
          )
          .get() != null
      );
    },

    /** Remove an account (disconnect). */
    remove(userId: string, provider: string): void {
      db.delete(providerAccounts)
        .where(
          and(
            eq(providerAccounts.userId, userId),
            eq(providerAccounts.provider, provider),
          ),
        )
        .run();
    },
  };
}

export type TokensRepo = ReturnType<typeof tokensRepo>;
