import { z } from "zod";
import { DateString, MetricSource } from "./metrics";
import { ErrorCode } from "../errors";

/**
 * AI coach schemas — §6 of docs/architecture/02-API-CONTRACT.md and
 * docs/architecture/05-AI-COACH.md.
 *
 * `POST /v1/coach/chat` is a STREAMING endpoint: the default response is an
 * AI-SDK UI-message stream over Server-Sent Events (`text/event-stream`). The
 * SSE event types are modeled below for documentation/typing of the client.
 * Non-streaming clients send `Accept: application/json` and get the final
 * `CoachChatJsonResponse` (`{ message, citations }`) instead.
 *
 * The user id is ALWAYS resolved from the validated session, never the body.
 */

/* -------------------------------------------------------------------------- */
/* Messages                                                                   */
/* -------------------------------------------------------------------------- */

export const CoachRole = z.enum(["user", "assistant", "tool"]);
export type CoachRole = z.infer<typeof CoachRole>;

/**
 * A chat message. Content is plain text on the wire for the request turn;
 * persisted assistant/tool messages carry richer parts (see CoachMessage in the
 * DB layer) but the contract surface for a turn is text.
 */
export const CoachMessage = z.object({
  role: CoachRole,
  content: z.string(),
});
export type CoachMessage = z.infer<typeof CoachMessage>;

/* -------------------------------------------------------------------------- */
/* Request                                                                    */
/* -------------------------------------------------------------------------- */

/** `POST /v1/coach/chat` request body. */
export const CoachChatRequest = z.object({
  /** Optional; omitted ⇒ ephemeral conversation (not persisted). */
  conversationId: z.string().optional(),
  messages: z.array(CoachMessage).min(1),
});
export type CoachChatRequest = z.infer<typeof CoachChatRequest>;

/* -------------------------------------------------------------------------- */
/* Citations (grounding)                                                      */
/* -------------------------------------------------------------------------- */

/**
 * A grounded figure the coach cited — the tool-result envelope from
 * 05-AI-COACH.md §4 (`{ value, unit, asOf, source }`). Numbers come only from
 * tools/snapshot, so each cited number is auditable.
 */
export const CoachCitation = z.object({
  value: z.number(),
  unit: z.string(),
  asOf: DateString,
  source: MetricSource,
});
export type CoachCitation = z.infer<typeof CoachCitation>;

/* -------------------------------------------------------------------------- */
/* Streamed response (SSE event types)                                        */
/* -------------------------------------------------------------------------- */

/** A token chunk of the assistant's answer. */
export const CoachTextDeltaEvent = z.object({
  type: z.literal("text-delta"),
  delta: z.string(),
});
export type CoachTextDeltaEvent = z.infer<typeof CoachTextDeltaEvent>;

/** A tool invocation the model made (args grounded server-side). */
export const CoachToolCallEvent = z.object({
  type: z.literal("tool-call"),
  name: z.string(),
  args: z.record(z.unknown()),
});
export type CoachToolCallEvent = z.infer<typeof CoachToolCallEvent>;

/** A tool result — the grounding envelope so the UI can show "grounded in: …". */
export const CoachToolResultEvent = z.object({
  type: z.literal("tool-result"),
  name: z.string(),
  value: z.number(),
  unit: z.string(),
  asOf: DateString,
  source: MetricSource,
});
export type CoachToolResultEvent = z.infer<typeof CoachToolResultEvent>;

/** The mandatory verbatim medical disclaimer (emitted once per advice turn). */
export const CoachDisclaimerEvent = z.object({
  type: z.literal("data-disclaimer"),
  text: z.string(),
});
export type CoachDisclaimerEvent = z.infer<typeof CoachDisclaimerEvent>;

/** A stream error (same error vocabulary as §0). */
export const CoachErrorEvent = z.object({
  type: z.literal("error"),
  code: ErrorCode,
  message: z.string(),
});
export type CoachErrorEvent = z.infer<typeof CoachErrorEvent>;

/** Terminal event with finish reason + token usage. */
export const CoachDoneEvent = z.object({
  type: z.literal("done"),
  finishReason: z.string(),
  usage: z
    .object({
      inputTokens: z.number().optional(),
      outputTokens: z.number().optional(),
      cacheReadInputTokens: z.number().optional(),
    })
    .optional(),
});
export type CoachDoneEvent = z.infer<typeof CoachDoneEvent>;

/** Discriminated union of every SSE event the chat stream can emit. */
export const CoachStreamEvent = z.discriminatedUnion("type", [
  CoachTextDeltaEvent,
  CoachToolCallEvent,
  CoachToolResultEvent,
  CoachDisclaimerEvent,
  CoachErrorEvent,
  CoachDoneEvent,
]);
export type CoachStreamEvent = z.infer<typeof CoachStreamEvent>;

/* -------------------------------------------------------------------------- */
/* Non-streaming JSON fallback (Accept: application/json)                     */
/* -------------------------------------------------------------------------- */

export const CoachChatJsonResponse = z.object({
  message: CoachMessage,
  citations: z.array(CoachCitation),
});
export type CoachChatJsonResponse = z.infer<typeof CoachChatJsonResponse>;

/* -------------------------------------------------------------------------- */
/* Conversations (memory)                                                     */
/* -------------------------------------------------------------------------- */

/** List item for `GET /v1/coach/conversations`. */
export const CoachConversationSummary = z.object({
  id: z.string(),
  title: z.string().nullable(),
  updatedAt: z.number().int(), // epoch ms
});
export type CoachConversationSummary = z.infer<typeof CoachConversationSummary>;

export const CoachConversationListResponse = z.object({
  items: z.array(CoachConversationSummary),
  nextCursor: z.string().nullable(),
});
export type CoachConversationListResponse = z.infer<
  typeof CoachConversationListResponse
>;

/** `POST /v1/coach/conversations` response. */
export const CoachConversationCreateResponse = z.object({
  id: z.string(),
});
export type CoachConversationCreateResponse = z.infer<
  typeof CoachConversationCreateResponse
>;

/** `GET /v1/coach/conversations/:id` — full message history. */
export const CoachConversationHistoryResponse = z.object({
  id: z.string(),
  title: z.string().nullable(),
  messages: z.array(CoachMessage),
});
export type CoachConversationHistoryResponse = z.infer<
  typeof CoachConversationHistoryResponse
>;
