/**
 * Daily-snapshot context block + prompt-cache marker — 05-AI-COACH.md §6.
 *
 * The cached prefix is, in render order: system prompt → tool definitions →
 * this daily-snapshot block. All three are stable within a session, so we put
 * the `cache_control` breakpoint on the LAST stable element (the snapshot) and
 * every later turn reads the cache instead of re-encoding thousands of tokens.
 *
 * Caching rules honoured here:
 *  - The breakpoint lives on a `ModelMessage` text part, NOT on a `UIMessage`
 *    (those carry no provider options). The route converts incoming UIMessages
 *    to ModelMessages and injects this snapshot ahead of the history.
 *  - The per-turn volatile content (the new user question) goes AFTER this
 *    breakpoint so it never invalidates the prefix.
 *  - The snapshot's own `asOf` timestamps live INSIDE the cached block and are
 *    stable for the day; rolling to a new day (or a fresh sync) rebuilds the
 *    snapshot, intentionally writing a new cache entry.
 *
 * NOTE on the minimum cacheable prefix: `claude-sonnet-4-6` won't cache a prefix
 * below its minimum (the docs cite 2048 tokens; aim for >=1024 at minimum). The
 * snapshot is the main mass; if the prefix is still short it simply won't cache
 * (no error). `buildSnapshotMessage` therefore pads with a stable, honest
 * explainer so a real day's snapshot reliably clears the threshold.
 */
import type { ModelMessage } from "ai";

/** A grounded scalar for the snapshot, mirroring the tool envelope. */
export interface SnapshotMetric {
  value: number | string | null;
  unit: string;
  asOf: string; // YYYY-MM-DD
  source: "fitbit" | "google" | "ksfit" | "derived" | "estimate";
}

/**
 * The compact daily snapshot. Every field optional/nullable: signals arrive at
 * different times and some (HRV-gated Recovery) may be unavailable. `null`
 * values are rendered as "no data" so the model never invents one.
 */
export interface DailySnapshotInput {
  /** The day this snapshot describes (YYYY-MM-DD). Stable for the cache day. */
  date: string;
  recovery?: SnapshotMetric;
  strain?: SnapshotMetric;
  sleepPerformance?: SnapshotMetric;
  sleepAsleepMin?: SnapshotMetric;
  hrvRmssd?: SnapshotMetric;
  hrvTrend?: SnapshotMetric;
  restingHr?: SnapshotMetric;
  breathingRate?: SnapshotMetric;
  stress?: SnapshotMetric;
  fitnessAge?: SnapshotMetric;
  steps?: SnapshotMetric;
  caloriesOut?: SnapshotMetric;
  weightKg?: SnapshotMetric;
}

function renderMetric(label: string, m?: SnapshotMetric): string {
  if (!m || m.value === null || m.value === "") {
    return `- ${label}: no data`;
  }
  const unit = m.unit ? ` ${m.unit}` : "";
  return `- ${label}: ${m.value}${unit} (${m.source}, as of ${m.asOf})`;
}

/**
 * A stable explainer appended to every snapshot. It is honest (it restates the
 * grounding/estimate rules), invariant across turns, and helps the cached
 * prefix clear the model's minimum-token threshold so caching actually engages.
 */
const SNAPSHOT_EXPLAINER = [
  ``,
  `How to read this snapshot:`,
  `- These figures are the latest derived daily values, each tagged with its`,
  `  source and the date it is "as of". Treat them as the ground truth for today;`,
  `  prefer a fresh tool call when the user asks about a different day or a deeper`,
  `  breakdown (components, stages, trend bands).`,
  `- "no data" means the signal isn't available (device not worn, metric not yet`,
  `  wired, or gated). Say so plainly; never substitute a guessed value.`,
  `- Recovery, Strain, Sleep Need/Performance, Stress, and Fitness Age are`,
  `  Stride's own estimates, not WHOOP/Oura/clinical values. Stress is an HR-based`,
  `  arousal estimate, not an emotion or clinical measure. Strain is calibrated to`,
  `  this user's own 90-day range and is not comparable across people. Fitness Age`,
  `  is cardiorespiratory (VO2max vs norms), not biological age.`,
  `- Every number you cite must come from this block or a tool result, reported`,
  `  with its value, unit, and date. Do not compute or average values yourself.`,
].join("\n");

/** Build the compact human-readable snapshot string (stable for the day). */
export function buildSnapshotText(s: DailySnapshotInput): string {
  return [
    `Today's snapshot (for ${s.date}):`,
    renderMetric("Recovery (Stride estimate, 0–100)", s.recovery),
    renderMetric("Day Strain (Stride estimate, 0–21)", s.strain),
    renderMetric("Sleep Performance (Stride estimate, %)", s.sleepPerformance),
    renderMetric("Time asleep", s.sleepAsleepMin),
    renderMetric("HRV (RMSSD)", s.hrvRmssd),
    renderMetric("HRV trend", s.hrvTrend),
    renderMetric("Resting HR", s.restingHr),
    renderMetric("Breathing rate", s.breathingRate),
    renderMetric("Stress (HR-based estimate, 0–100)", s.stress),
    renderMetric("Fitness Age (cardiorespiratory)", s.fitnessAge),
    renderMetric("Steps", s.steps),
    renderMetric("Calories out", s.caloriesOut),
    renderMetric("Weight", s.weightKg),
    SNAPSHOT_EXPLAINER,
  ].join("\n");
}

/**
 * Build the snapshot as a cache-marked `ModelMessage`.
 *
 * It is a `user`-role message holding a single text part that carries the
 * Anthropic `cacheControl: { type: 'ephemeral' }` breakpoint. Inject this AHEAD
 * of the converted conversation history; the new user turn (volatile) follows
 * it, so the cached prefix (system + tools + snapshot) stays byte-stable for the
 * day. Verify caching with `cache_read_input_tokens > 0` on the 2nd turn.
 */
export function buildSnapshotMessage(s: DailySnapshotInput): ModelMessage {
  return {
    role: "user",
    content: [
      {
        type: "text",
        text: buildSnapshotText(s),
        providerOptions: {
          anthropic: { cacheControl: { type: "ephemeral" } },
        },
      },
    ],
  };
}
