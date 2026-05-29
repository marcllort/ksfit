/**
 * Encrypted, DB-backed Fitbit TokenStore (Phase 2).
 *
 * Replaces the cookie store: tokens live as AES-256-GCM rows in @stride/db
 * (provider_accounts), keyed by our internal user id, so the raw Fitbit JWT
 * never touches the browser. The store is per-user; the route resolves the
 * user id from the KS Fit session (usersRepo.ensureUser maps xjid → user).
 */
import { randomUUID } from "node:crypto";
import type { FitbitTokens, TokenStore } from "@stride/health-core";
import { FitbitProvider } from "@stride/health-core";
import { tokensRepo, usersRepo } from "@stride/db";
import { db } from "../db.ts";

const PROVIDER = "fitbit";

/** Map a KS Fit xjid to our internal user id, creating the row if needed. */
export function userIdForXjid(xjid: string): string {
  return usersRepo(db()).ensureUser(xjid);
}

/** A DB-backed TokenStore for one user's Fitbit account. */
export function dbTokenStore(userId: string): TokenStore {
  const repo = tokensRepo(db());
  return {
    get(): FitbitTokens | null {
      const row = repo.get(userId, PROVIDER);
      if (!row || !row.refreshToken) return null;
      return {
        accessToken: row.accessToken,
        refreshToken: row.refreshToken,
        expiresAt: row.expiresAt ?? 0,
        userId: row.providerUserId ?? "",
        scope: row.scope ?? "",
      };
    },
    set(t: FitbitTokens): void {
      repo.upsert({
        id: randomUUID(),
        userId,
        provider: PROVIDER,
        providerUserId: t.userId || null,
        accessToken: t.accessToken,
        refreshToken: t.refreshToken,
        expiresAt: t.expiresAt,
        scope: t.scope,
      });
    },
    clear(): void {
      repo.remove(userId, PROVIDER);
    },
  };
}

/** A FitbitProvider bound to a user's encrypted DB token store. */
export function fitbitForUser(userId: string): FitbitProvider {
  return new FitbitProvider(dbTokenStore(userId));
}
