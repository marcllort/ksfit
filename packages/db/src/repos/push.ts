/**
 * push_subscriptions repo — one table backs both transports: Web Push (VAPID)
 * now and APNs (iOS) later. The weekly-weigh-in cron reads active subscriptions
 * for a user and a dispatcher fans out per kind. keysJson holds {p256dh, auth}
 * for Web Push; APNs rows use endpoint as the device token and omit keys.
 */

import { and, eq, isNull } from "drizzle-orm";

import type { StrideDb } from "../client";
import { pushSubscriptions } from "../schema";

export type PushKind = "web" | "apns";

export interface WebPushKeys {
  p256dh: string;
  auth: string;
}

export interface PushSubscriptionInput {
  id: string;
  userId: string;
  kind: PushKind;
  /** Web Push endpoint URL, or APNs device token. */
  endpoint: string;
  /** Web Push only. */
  keys?: WebPushKeys | null;
  createdAt?: number;
}

export interface PushSubscription {
  id: string;
  userId: string;
  kind: PushKind;
  endpoint: string;
  keys: WebPushKeys | null;
  createdAt: number;
  lastSeen: number | null;
  revokedAt: number | null;
}

export function pushRepo(db: StrideDb) {
  return {
    /** Register a subscription; re-subscribing the same endpoint refreshes keys. */
    subscribe(input: PushSubscriptionInput): void {
      const now = input.createdAt ?? Date.now();
      const existing = db
        .select({ id: pushSubscriptions.id })
        .from(pushSubscriptions)
        .where(eq(pushSubscriptions.endpoint, input.endpoint))
        .get();

      if (existing) {
        db.update(pushSubscriptions)
          .set({
            userId: input.userId,
            kind: input.kind,
            keysJson: input.keys ? JSON.stringify(input.keys) : null,
            lastSeen: now,
            revokedAt: null,
          })
          .where(eq(pushSubscriptions.id, existing.id))
          .run();
        return;
      }

      db.insert(pushSubscriptions)
        .values({
          id: input.id,
          userId: input.userId,
          kind: input.kind,
          endpoint: input.endpoint,
          keysJson: input.keys ? JSON.stringify(input.keys) : null,
          createdAt: now,
          lastSeen: now,
          revokedAt: null,
        })
        .run();
    },

    /** Active (non-revoked) subscriptions for a user — what the cron sends to. */
    listActive(userId: string): PushSubscription[] {
      const rows = db
        .select()
        .from(pushSubscriptions)
        .where(
          and(
            eq(pushSubscriptions.userId, userId),
            isNull(pushSubscriptions.revokedAt),
          ),
        )
        .all();
      return rows.map((row) => ({
        id: row.id,
        userId: row.userId,
        kind: row.kind as PushKind,
        endpoint: row.endpoint,
        keys: row.keysJson ? (JSON.parse(row.keysJson) as WebPushKeys) : null,
        createdAt: row.createdAt,
        lastSeen: row.lastSeen ?? null,
        revokedAt: row.revokedAt ?? null,
      }));
    },

    /** Mark a subscription revoked (e.g. endpoint returned 410 Gone). */
    revoke(endpoint: string, now = Date.now()): void {
      db.update(pushSubscriptions)
        .set({ revokedAt: now })
        .where(eq(pushSubscriptions.endpoint, endpoint))
        .run();
    },
  };
}

export type PushRepo = ReturnType<typeof pushRepo>;
