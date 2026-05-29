/**
 * app_sessions repo — opaque session tokens for our backend auth. We store only
 * the SHA-256 hash of the 256-bit token, so a DB leak yields no live sessions.
 * The plaintext is returned once at mint time; validation hashes the incoming
 * token and looks the row up.
 */

import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";

import type { StrideDb } from "../client";
import { appSessions } from "../schema";

export type SessionTransport = "cookie" | "bearer";

export interface MintedSession {
  /** The plaintext opaque token — returned ONCE, never persisted. */
  token: string;
  id: string;
  userId: string;
  expiresAt: number | null;
}

export interface SessionRow {
  id: string;
  userId: string;
  transport: SessionTransport;
  createdAt: number;
  lastSeenAt: number;
  expiresAt: number | null;
  revokedAt: number | null;
}

/** SHA-256 of the opaque token, hex-encoded. */
export function hashToken(token: string): string {
  return createHash("sha256").update(token).digest("hex");
}

export function sessionsRepo(db: StrideDb) {
  return {
    /**
     * Mint a new opaque session, store its hash, and return the plaintext once.
     * @param ttlMs optional time-to-live; omit for a non-expiring session.
     */
    mint(
      id: string,
      userId: string,
      transport: SessionTransport,
      ttlMs?: number,
    ): MintedSession {
      const token = randomBytes(32).toString("base64url"); // 256-bit
      const now = Date.now();
      const expiresAt = ttlMs != null ? now + ttlMs : null;
      db.insert(appSessions)
        .values({
          id,
          userId,
          tokenHash: hashToken(token),
          transport,
          createdAt: now,
          lastSeenAt: now,
          expiresAt,
          revokedAt: null,
        })
        .run();
      return { token, id, userId, expiresAt };
    },

    /**
     * Validate an incoming token: returns the live session row or null when the
     * token is unknown, revoked, or expired. Touches last_seen_at on success.
     */
    validate(token: string, now = Date.now()): SessionRow | null {
      const row = db
        .select()
        .from(appSessions)
        .where(
          and(
            eq(appSessions.tokenHash, hashToken(token)),
            isNull(appSessions.revokedAt),
          ),
        )
        .get();
      if (!row) return null;
      if (row.expiresAt != null && row.expiresAt <= now) return null;

      db.update(appSessions)
        .set({ lastSeenAt: now })
        .where(eq(appSessions.id, row.id))
        .run();

      return {
        id: row.id,
        userId: row.userId,
        transport: row.transport as SessionTransport,
        createdAt: row.createdAt,
        lastSeenAt: now,
        expiresAt: row.expiresAt ?? null,
        revokedAt: row.revokedAt ?? null,
      };
    },

    /** Revoke by id (logout). */
    revoke(id: string, now = Date.now()): void {
      db.update(appSessions)
        .set({ revokedAt: now })
        .where(eq(appSessions.id, id))
        .run();
    },

    /** Revoke every session for a user. */
    revokeAllForUser(userId: string, now = Date.now()): void {
      db.update(appSessions)
        .set({ revokedAt: now })
        .where(and(eq(appSessions.userId, userId), isNull(appSessions.revokedAt)))
        .run();
    },
  };
}

export type SessionsRepo = ReturnType<typeof sessionsRepo>;
