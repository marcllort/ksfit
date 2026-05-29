/**
 * Model + provider selection for the Stride coach.
 *
 * One door to the Anthropic Messages API via the Vercel AI SDK provider
 * (`@ai-sdk/anthropic`). The provider reads `ANTHROPIC_API_KEY` from the
 * environment by default; we surface it here so misconfiguration fails loudly
 * at startup rather than mid-stream.
 *
 * Model IDs are pinned bare strings — NO date suffixes (see 05-AI-COACH.md §2):
 *  - `claude-sonnet-4-6` for interactive chat (good interpretation at chat cost),
 *  - `claude-haiku-4-5` for the cheap background briefing cron.
 *
 * Switching the chat tier to Opus later is a one-line change here.
 */
import { createAnthropic } from "@ai-sdk/anthropic";
import type { AnthropicLanguageModelOptions } from "@ai-sdk/anthropic";
import type { LanguageModel } from "ai";

/** Pinned model ids. Bare strings — never append a date suffix. */
export const COACH_MODEL_IDS = {
  /** Interactive chat: balanced interpretation quality at chat latency/cost. */
  chat: "claude-sonnet-4-6",
  /** Background briefing cron (morning summary, weekly reminder copy). */
  briefing: "claude-haiku-4-5",
} as const;

export type CoachModelKind = keyof typeof COACH_MODEL_IDS;

/**
 * The Anthropic provider instance. `apiKey` defaults to `ANTHROPIC_API_KEY`;
 * we pass it explicitly so a missing key is obvious and so tests can inject one
 * via `createCoachProvider`.
 */
export function createCoachProvider(apiKey: string = process.env.ANTHROPIC_API_KEY ?? "") {
  if (!apiKey) {
    throw new Error(
      "ANTHROPIC_API_KEY is not set — the coach cannot reach the model. " +
        "Set it in the backend environment.",
    );
  }
  return createAnthropic({ apiKey });
}

/** Default provider, lazily constructed so importing this file never throws. */
let defaultProvider: ReturnType<typeof createCoachProvider> | null = null;
function provider() {
  return (defaultProvider ??= createCoachProvider());
}

/** Resolve a pinned model id to an AI SDK `LanguageModel`. */
export function coachModel(kind: CoachModelKind = "chat"): LanguageModel {
  return provider()(COACH_MODEL_IDS[kind]);
}

/**
 * Provider options applied to every coach turn. Adaptive thinking lets Claude
 * decide how much to reason over the handful of tool results; the coach is not
 * a long-horizon agent. Passed through `providerOptions.anthropic` by the SDK.
 */
export const COACH_PROVIDER_OPTIONS: { anthropic: AnthropicLanguageModelOptions } = {
  anthropic: {
    thinking: { type: "adaptive" },
  },
};

/** Hard cap on tokens per turn so a turn can't run away (safety §6). */
export const COACH_MAX_OUTPUT_TOKENS = 1500;

/** Bounded agentic loop: at most 6 tool-call rounds per turn (safety §6). */
export const COACH_MAX_STEPS = 6;
