/**
 * users repo — the single self-hosted user (multi-user-ready column set).
 *
 * `ensureUser` is the idempotent entry point the backend calls when it resolves
 * a KS Fit session: it maps the upstream xjid to our internal user id, creating
 * the row on first sight so token/metric foreign keys are satisfiable.
 */
import { eq } from "drizzle-orm";
import type { StrideDb } from "../client";
import { users } from "../schema";

export interface ProfilePatch {
  displayName?: string | null;
  birthDate?: string | null; // YYYY-MM-DD
  sex?: string | null; // 'male' | 'female' | 'unspecified'
  heightCm?: number | null;
  waistCm?: number | null;
  hrMaxOverride?: number | null;
}

/** Deterministic id for the single self-hosted user keyed on the KS Fit xjid. */
function idForXjid(xjid: string): string {
  return `user_${xjid}`;
}

export function usersRepo(db: StrideDb) {
  return {
    /** Create-or-return the user row for a KS Fit xjid. Idempotent. */
    ensureUser(xjid: string, now = Date.now()): string {
      const id = idForXjid(xjid);
      db.insert(users)
        .values({ id, ksfitXjid: xjid, createdAt: now, updatedAt: now })
        .onConflictDoNothing()
        .run();
      return id;
    },

    findByXjid(xjid: string) {
      return (
        db.select().from(users).where(eq(users.ksfitXjid, xjid)).get() ?? null
      );
    },

    get(userId: string) {
      return db.select().from(users).where(eq(users.id, userId)).get() ?? null;
    },

    updateProfile(userId: string, patch: ProfilePatch, now = Date.now()): void {
      db.update(users)
        .set({ ...patch, updatedAt: now })
        .where(eq(users.id, userId))
        .run();
    },
  };
}
