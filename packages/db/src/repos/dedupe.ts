/**
 * pushed_activities repo — the push-walk dedupe ledger (replaces the legacy
 * fitbit_logged cookie array, no 500-id cap). isLogged(sourceId) is a row-exists
 * check keyed by (user, provider, source_id); the push route records on success.
 */

import { and, eq } from "drizzle-orm";

import type { StrideDb } from "../client";
import { pushedActivities } from "../schema";

export interface PushedActivity {
  userId: string;
  provider: string;
  sourceId: string;
  externalId: string | null;
  pushedAt: number;
}

export function dedupeRepo(db: StrideDb) {
  return {
    /** Has this source session already been pushed for (user, provider)? */
    isLogged(userId: string, provider: string, sourceId: string): boolean {
      return (
        db
          .select({ sourceId: pushedActivities.sourceId })
          .from(pushedActivities)
          .where(
            and(
              eq(pushedActivities.userId, userId),
              eq(pushedActivities.provider, provider),
              eq(pushedActivities.sourceId, sourceId),
            ),
          )
          .get() != null
      );
    },

    /**
     * Record a successful push. Idempotent: a duplicate (user, provider,
     * source_id) is ignored so cron re-runs never double-insert.
     */
    record(
      userId: string,
      provider: string,
      sourceId: string,
      externalId: string | null = null,
      pushedAt = Date.now(),
    ): void {
      db.insert(pushedActivities)
        .values({ userId, provider, sourceId, externalId, pushedAt })
        .onConflictDoNothing({
          target: [
            pushedActivities.userId,
            pushedActivities.provider,
            pushedActivities.sourceId,
          ],
        })
        .run();
    },

    /** All pushed source ids for (user, provider) — for backfill/inspection. */
    listSourceIds(userId: string, provider: string): string[] {
      return db
        .select({ sourceId: pushedActivities.sourceId })
        .from(pushedActivities)
        .where(
          and(
            eq(pushedActivities.userId, userId),
            eq(pushedActivities.provider, provider),
          ),
        )
        .all()
        .map((r) => r.sourceId);
    },
  };
}

export type DedupeRepo = ReturnType<typeof dedupeRepo>;
