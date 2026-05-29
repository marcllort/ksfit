/**
 * Stress monitor — HR-based arousal ESTIMATE (04-FEATURES §5).
 *
 * The most fabrication-prone metric in the app: neither the Fitbit Web API nor
 * the Google Health API exposes EDA / a Stress Management Score, so this is
 * FULLY self-derived from HR elevation over resting. It is intentionally coarse
 * and MUST be surfaced as "Stress (HR-based estimate)" — an estimate of
 * physiological arousal, not an emotional or clinical stress measure.
 *
 * For each awake, non-exercise minute:
 *   arousal(t) = clamp((HR(t) − HRrest)/(HRmax − HRrest), 0, 1)
 *   stressMin  = % of awake non-exercise minutes with arousal > 0.30
 *   stressIdx  = 100 · mean(arousal over awake non-exercise minutes)   // 0–100
 *
 * Bucketed Low/Medium/High by the user's own trailing-30-day terciles
 * (self-calibrated), falling back to fixed cuts until enough history exists.
 */
import type { Exercise, HeartRatePoint } from "../types";
import { clamp, percentile } from "./baseline";

/** Arousal threshold above which a minute is counted "elevated". */
export const STRESS_AROUSAL_THRESHOLD = 0.3;
/** Days of history needed before personal terciles replace fixed cuts. */
export const STRESS_CALIBRATION_DAYS = 30;
/** Fixed bucket cuts on the 0–100 index until calibrated. */
export const STRESS_FALLBACK_CUTS = { low: 20, high: 40 } as const;

export type StressBucket = "low" | "medium" | "high";

/** A [start, end) window (epoch ms) to exclude — e.g. a workout or sleep. */
export interface ExclusionWindow {
  startMs: number;
  endMs: number;
}

/** Build exclusion windows from logged exercises (start .. start+duration). */
export function exerciseWindows(exercises: readonly Exercise[]): ExclusionWindow[] {
  return exercises.map((e) => {
    const startMs = e.startTime.getTime();
    return { startMs, endMs: startMs + e.durationSec * 1000 };
  });
}

function inAnyWindow(t: number, windows: readonly ExclusionWindow[]): boolean {
  for (const w of windows) {
    if (t >= w.startMs && t < w.endMs) return true;
  }
  return false;
}

export interface StressInputs {
  intraday: readonly HeartRatePoint[];
  restingHr: number;
  hrMax: number;
  /** Exercise windows to exclude (use exerciseWindows()). */
  exclude?: readonly ExclusionWindow[];
  /** Optional sleep window to exclude so "daytime" arousal only. */
  sleepWindow?: ExclusionWindow | null;
  /** Trailing daily stress-index history (any order) for tercile calibration. */
  indexHistory?: readonly number[];
}

export interface StressResult {
  /** 0–100 day arousal index. */
  index: number;
  /** % of counted minutes above the arousal threshold (0–100). */
  elevatedPct: number;
  /** Minutes folded into the estimate (coverage proxy). */
  minutes: number;
  bucket: StressBucket;
  /** True while using fixed cuts (history < 30 days). */
  calibrating: boolean;
  /** Honest label literal callers must surface. */
  label: "Stress (HR-based estimate)";
}

function bucketFor(
  index: number,
  history: readonly number[],
): { bucket: StressBucket; calibrating: boolean } {
  const valid = history.filter((v) => Number.isFinite(v));
  if (valid.length < STRESS_CALIBRATION_DAYS) {
    const bucket: StressBucket =
      index <= STRESS_FALLBACK_CUTS.low
        ? "low"
        : index <= STRESS_FALLBACK_CUTS.high
          ? "medium"
          : "high";
    return { bucket, calibrating: true };
  }
  const t1 = percentile(valid, 1 / 3);
  const t2 = percentile(valid, 2 / 3);
  const bucket: StressBucket = index <= t1 ? "low" : index <= t2 ? "medium" : "high";
  return { bucket, calibrating: false };
}

/**
 * Compute the HR-based stress estimate for a day. Returns index 0 (low) when
 * no usable minutes remain after exclusions or the HR reserve is degenerate.
 */
export function computeStress(inputs: StressInputs): StressResult {
  const reserve = inputs.hrMax - inputs.restingHr;
  const exclude = inputs.exclude ?? [];

  let sum = 0;
  let elevated = 0;
  let minutes = 0;

  if (reserve > 0) {
    for (const p of inputs.intraday) {
      if (!Number.isFinite(p.t) || !Number.isFinite(p.bpm)) continue;
      if (inAnyWindow(p.t, exclude)) continue;
      if (
        inputs.sleepWindow &&
        p.t >= inputs.sleepWindow.startMs &&
        p.t < inputs.sleepWindow.endMs
      ) {
        continue;
      }
      const arousal = clamp((p.bpm - inputs.restingHr) / reserve, 0, 1);
      sum += arousal;
      if (arousal > STRESS_AROUSAL_THRESHOLD) elevated += 1;
      minutes += 1;
    }
  }

  const index = minutes > 0 ? 100 * (sum / minutes) : 0;
  const elevatedPct = minutes > 0 ? (100 * elevated) / minutes : 0;
  const { bucket, calibrating } = bucketFor(index, inputs.indexHistory ?? []);

  return {
    index,
    elevatedPct,
    minutes,
    bucket,
    calibrating,
    label: "Stress (HR-based estimate)",
  };
}
