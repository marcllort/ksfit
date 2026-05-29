/**
 * streamCoach — wires the model, frozen system prompt, grounded tools, the
 * cache-marked daily snapshot, and the bounded loop into one `streamText` call.
 * 05-AI-COACH.md §3 / §6.
 *
 * PER-USER SCOPING (non-negotiable, §1.4 / §8.5): the caller passes a
 * `dataSource` that is ALREADY scoped to the authenticated session's user. The
 * tools expose no user-id parameter and this function takes no user id — the
 * route resolves identity from the session and is the sole source of truth. A
 * client-supplied user id is never trusted or even accepted here.
 *
 * Caching: incoming `UIMessage`s carry no provider options, so we convert them
 * to `ModelMessage`s and inject the cache-marked snapshot ahead of the history.
 * Render order of the cached prefix: system prompt → tool defs → snapshot.
 */
import {
  streamText,
  stepCountIs,
  convertToModelMessages,
  type UIMessage,
  type ModelMessage,
  type StreamTextResult,
  type ToolSet,
} from "ai";
import {
  coachModel,
  COACH_PROVIDER_OPTIONS,
  COACH_MAX_OUTPUT_TOKENS,
  COACH_MAX_STEPS,
  type CoachModelKind,
} from "./model.ts";
import { COACH_SYSTEM_PROMPT } from "./systemPrompt.ts";
import { buildCoachTools, type CoachDataSource } from "./tools.ts";
import { buildSnapshotMessage, type DailySnapshotInput } from "./context.ts";

export interface StreamCoachArgs {
  /**
   * Conversation history + the new turn. Either UI messages (from `useChat`)
   * or already-converted model messages (e.g. loaded from `coach_messages`).
   * UI messages are converted; the snapshot is injected ahead of them.
   */
  messages: UIMessage[] | ModelMessage[];
  /**
   * Data source ALREADY scoped to the authenticated user. Built by the route;
   * never derived from anything the client sends.
   */
  dataSource: CoachDataSource;
  /** The day's snapshot to prepend (cache-marked). Omit only when none exists. */
  snapshot?: DailySnapshotInput;
  /** Model tier — `chat` (default) for interactive, `briefing` for the cron. */
  kind?: CoachModelKind;
  /** Cooperative cancellation (wire the request's AbortSignal here). */
  abortSignal?: AbortSignal;
  /**
   * Persist the final transcript. Wired to `memory.save(userId, convId, msgs)`
   * by the route; the AI SDK calls it with `response.messages` in `onFinish`.
   */
  onFinish?: (event: { responseMessages: ModelMessage[] }) => void | Promise<void>;
}

/** Type guard: have we been handed UI messages (which need conversion)? */
function isUIMessages(m: UIMessage[] | ModelMessage[]): m is UIMessage[] {
  // UIMessage has `parts`; ModelMessage has `content`. Empty arrays convert fine.
  return m.length === 0 || "parts" in (m[0] as Record<string, unknown>);
}

/**
 * Run a coach turn and return the streaming result. The route turns this into
 * an SSE response via `result.toUIMessageStreamResponse()` (web `useChat`) or
 * `result.toTextStreamResponse()` (iOS raw SSE) — the core logic depends on no
 * web-only helper.
 */
export async function streamCoach(
  args: StreamCoachArgs,
): Promise<StreamTextResult<ToolSet, never>> {
  const { messages, dataSource, snapshot, kind = "chat", abortSignal, onFinish } = args;

  const history: ModelMessage[] = isUIMessages(messages)
    ? await convertToModelMessages(messages)
    : messages;

  // Cached prefix is system + tools; the snapshot is the cache-marked element
  // injected ahead of the (volatile) conversation turns.
  const modelMessages: ModelMessage[] = snapshot
    ? [buildSnapshotMessage(snapshot), ...history]
    : history;

  return streamText({
    model: coachModel(kind),
    system: COACH_SYSTEM_PROMPT,
    messages: modelMessages,
    tools: buildCoachTools(dataSource),
    stopWhen: stepCountIs(COACH_MAX_STEPS),
    maxOutputTokens: COACH_MAX_OUTPUT_TOKENS,
    providerOptions: COACH_PROVIDER_OPTIONS,
    abortSignal,
    onFinish: onFinish
      ? ({ response }) => onFinish({ responseMessages: response.messages })
      : undefined,
  });
}
