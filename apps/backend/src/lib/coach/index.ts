/**
 * @stride/backend coach module — the AI health coach (05-AI-COACH.md).
 *
 * A thin, grounded interpretive layer over the deterministically-computed
 * metrics. The model interprets and cites; the backend computes. Built on the
 * Vercel AI SDK (`ai`) with the Anthropic provider (`@ai-sdk/anthropic`).
 *
 * The human wires:
 *  1. a `CoachDataSource` scoped to the authenticated user (over
 *     `packages/health-core` metrics + the `HealthProvider` fetchers),
 *  2. a `DailySnapshotInput` from the current daily-metric rows,
 *  3. the route that calls `streamCoach` and streams the result to the client,
 *  4. memory load/save against `packages/db` `coach_*` tables.
 */

// Model + provider selection.
export {
  COACH_MODEL_IDS,
  COACH_PROVIDER_OPTIONS,
  COACH_MAX_OUTPUT_TOKENS,
  COACH_MAX_STEPS,
  createCoachProvider,
  coachModel,
  type CoachModelKind,
} from "./model.ts";

// Frozen system prompt.
export { COACH_SYSTEM_PROMPT } from "./systemPrompt.ts";

// Tools + the injected data-source seam + grounding envelope.
export {
  buildCoachTools,
  grounded,
  unavailable,
  type CoachDataSource,
  type Grounded,
  type GroundedSource,
  type Unavailable,
  type ToolResult,
  type RecoveryPayload,
  type SleepPayload,
  type HrvTrendPayload,
  type DailyActivityPayload,
  type ExerciseSummary,
} from "./tools.ts";

// Daily-snapshot context block + cache marker.
export {
  buildSnapshotText,
  buildSnapshotMessage,
  type DailySnapshotInput,
  type SnapshotMetric,
} from "./context.ts";

// The streamText wiring.
export { streamCoach, type StreamCoachArgs } from "./chat.ts";
