/**
 * coach repo — conversation memory for the AI coach. coach_messages.content holds
 * AI SDK ModelMessage parts as JSON (text + tool-call + tool-result), so a reload
 * reconstructs the exact model-visible history and citations stay grounded.
 * Conversations are scoped by user_id; tool results are preserved, not just text.
 */

import { and, asc, desc, eq } from "drizzle-orm";

import type { StrideDb } from "../client";
import { coachConversations, coachMessages } from "../schema";

export type CoachRole = "user" | "assistant" | "tool";

export interface CoachMessageInput {
  id: string;
  conversationId: string;
  role: CoachRole;
  /** ModelMessage parts; stored as JSON. */
  content: unknown;
  /** AI SDK tool-call parts, surfaced separately for inspection. */
  toolCalls?: unknown;
  /** Token usage for cost tracking. */
  tokenUsage?: unknown;
  createdAt?: number;
}

export interface CoachMessage {
  id: string;
  conversationId: string;
  role: CoachRole;
  content: unknown;
  toolCalls: unknown | null;
  tokenUsage: unknown | null;
  createdAt: number;
}

function parseJson<T>(v: string | null): T | null {
  return v == null ? null : (JSON.parse(v) as T);
}

export function coachRepo(db: StrideDb) {
  return {
    /** Create a conversation owned by userId. */
    createConversation(
      id: string,
      userId: string,
      title?: string | null,
      now = Date.now(),
    ): void {
      db.insert(coachConversations)
        .values({
          id,
          userId,
          title: title ?? null,
          createdAt: now,
          updatedAt: now,
        })
        .run();
    },

    /** List a user's conversations, most-recently-updated first. */
    listConversations(userId: string) {
      return db
        .select()
        .from(coachConversations)
        .where(eq(coachConversations.userId, userId))
        .orderBy(desc(coachConversations.updatedAt))
        .all();
    },

    /** Append a message; bumps the parent conversation's updatedAt. */
    addMessage(input: CoachMessageInput): void {
      const now = input.createdAt ?? Date.now();
      db.insert(coachMessages)
        .values({
          id: input.id,
          conversationId: input.conversationId,
          role: input.role,
          content: JSON.stringify(input.content),
          toolCallsJson:
            input.toolCalls == null ? null : JSON.stringify(input.toolCalls),
          tokenUsage:
            input.tokenUsage == null ? null : JSON.stringify(input.tokenUsage),
          createdAt: now,
        })
        .run();
      db.update(coachConversations)
        .set({ updatedAt: now })
        .where(eq(coachConversations.id, input.conversationId))
        .run();
    },

    /**
     * Load a conversation's messages in order (oldest first). Verifies the
     * conversation belongs to userId so the coach can't read another user's
     * memory; returns [] if it doesn't.
     * @param limit cap to the last N messages (sliding window); omit for all.
     */
    loadMessages(
      conversationId: string,
      userId: string,
      limit?: number,
    ): CoachMessage[] {
      const owns = db
        .select({ id: coachConversations.id })
        .from(coachConversations)
        .where(
          and(
            eq(coachConversations.id, conversationId),
            eq(coachConversations.userId, userId),
          ),
        )
        .get();
      if (!owns) return [];

      const base = db
        .select()
        .from(coachMessages)
        .where(eq(coachMessages.conversationId, conversationId));

      // For a sliding window, take the newest N then re-sort ascending.
      const rows = limit
        ? base.orderBy(desc(coachMessages.createdAt)).limit(limit).all().reverse()
        : base.orderBy(asc(coachMessages.createdAt)).all();

      return rows.map((row) => ({
        id: row.id,
        conversationId: row.conversationId,
        role: row.role as CoachRole,
        content: JSON.parse(row.content),
        toolCalls: parseJson(row.toolCallsJson),
        tokenUsage: parseJson(row.tokenUsage),
        createdAt: row.createdAt,
      }));
    },
  };
}

export type CoachRepo = ReturnType<typeof coachRepo>;
