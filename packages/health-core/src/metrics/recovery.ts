/**
 * Recovery score 0–100 (04-FEATURES §1).
 *
 * Each overnight signal becomes a z-score against its own 30-night EWMA
 * baseline, sign-oriented so "better recovery → higher":
 *   z_hrv   = +z(rmssd)                 // higher HRV = better
 *   z_rhr   = −z(restingHr)             // lower RHR = better
 *   z_br    = −z(breathingRate)         // lower/stable BR = better
 *   z_sleep = (sleepPerformance − 100) / 15, clamped to [−3, +3]
 *
 *   S = 0.50·z_hrv + 0.25·z_rhr + 0.10·z_br + 0.15·z_sleep
 *   recovery = round(100 · Φ(S))        // Φ = standard-normal CDF → 50 = at baseline
 *
 * GATE (hard): HRV is a prerequisite. If fewer than ~14 nights of HRV exist, or
 * HRV is missing for the target night, we return `score: null` + a
 * `gatedReason`. Without HRV this is not honestly a recovery score.
 *
 * Weights are *ours*, surfaced and tunable; defaults live in DEFAULT_RECOVERY_WEIGHTS.
 */
import type { BreathingReading, HrvReading } from "../types";
import { clamp, ewma, standardNormalCdf, zScore } from "./baseline";
import { HRV_MIN_NIGHTS } from "./hrv";

/** EWMA span for every recovery input baseline (nights). */
export const RECOVERY_BASELINE_SPAN = 30;

export interface RecoveryWeights {
  hrv: number;
  rhr: number;
  br: number;
  sleep: number;
}

/** Default blend (04-FEATURES §1). Surfaced so the UI can show/edit them. */
export const DEFAULT_RECOVERY_WEIGHTS: RecoveryWeights = {
  hrv: 0.5,
  rhr: 0.25,
  br: 0.1,
  sleep: 0.15,
};

/** Band labels (thresholds ours, WHOOP-style traffic light). */
export type RecoveryBand = "green" | "yellow" | "red";

export interface RecoveryComponents {
  /** Oriented z-scores actually fed into the blend (post sign-flip + clamp). */
  hrvZ: number;
  rhrZ: number;
  brZ: number;
  sleepZ: number;
}

export type RecoveryGateReason =
  | "no-hrv-history"
  | "insufficient-hrv-history"
  | "no-hrv-tonight";

export interface RecoveryResult {
  score: number | null;
  band: RecoveryBand | null;
  components: RecoveryComponents;
  weights: RecoveryWeights;
  /** Raw weighted z-sum S before the Φ map (null when gated). */
  s: number | null;
  /** Set when the score is withheld; the UI shows components + this reason. */
  gatedReason?: RecoveryGateReason;
}

export interface RecoveryInputs {
  /** Tonight's RMSSD (ms). null/absent ⇒ HRV gate fires. */
  hrvTonight?: number | null;
  /** Trailing nightly RMSSD history (any order); ≥14 usable nights to ungate. */
  hrvHistory: readonly HrvReading[];

  /** Tonight's resting HR (bpm). */
  restingHrTonight?: number | null;
  /** Trailing resting-HR history (bpm), oldest → newest not required. */
  restingHrHistory: readonly number[];

  /** Tonight's breathing rate (breaths/min). */
  breathingTonight?: number | null;
  /** Trailing breathing-rate history. */
  breathingHistory?: readonly (number | BreathingReading)[];

  /** Tonight's sleep performance % (0–100+) from sleep.ts; optional. */
  sleepPerformance?: number | null;

  /** Override weights (else DEFAULT_RECOVERY_WEIGHTS). */
  weights?: RecoveryWeights;
}

function bandFor(score: number): RecoveryBand {
  if (score >= 67) return "green";
  if (score >= 34) return "yellow";
  return "red";
}

function brValue(x: number | BreathingReading): number {
  return typeof x === "number" ? x : x.breathsPerMin;
}

/**
 * Compute the gated Recovery score. Returns `score: null` + `gatedReason` when
 * HRV is missing/insufficient; otherwise a 0–100 score with its component
 * z-scores. RHR/breathing/sleep contribute 0 when their own data is absent
 * (treated as "at baseline") — only HRV gates.
 */
export function computeRecovery(inputs: RecoveryInputs): RecoveryResult {
  const weights = inputs.weights ?? DEFAULT_RECOVERY_WEIGHTS;

  // --- HRV component (the gate) -------------------------------------------
  const hrvSeries = inputs.hrvHistory
    .map((r) => r.rmssd)
    .filter((v) => Number.isFinite(v) && v > 0);
  const hrvState = ewma(hrvSeries, { span: RECOVERY_BASELINE_SPAN, ln: true });

  // --- RHR component ------------------------------------------------------
  const rhrState = ewma(
    inputs.restingHrHistory.filter((v) => Number.isFinite(v)),
    { span: RECOVERY_BASELINE_SPAN },
  );
  const rhrZ =
    inputs.restingHrTonight != null
      ? -zScore(inputs.restingHrTonight, rhrState)
      : 0;

  // --- Breathing component ------------------------------------------------
  const brSeries = (inputs.breathingHistory ?? [])
    .map(brValue)
    .filter((v) => Number.isFinite(v));
  const brState = ewma(brSeries, { span: RECOVERY_BASELINE_SPAN });
  const brZ =
    inputs.breathingTonight != null
      ? -zScore(inputs.breathingTonight, brState)
      : 0;

  // --- Sleep component (pseudo-z) -----------------------------------------
  const sleepZ =
    inputs.sleepPerformance != null
      ? clamp((inputs.sleepPerformance - 100) / 15, -3, 3)
      : 0;

  // The gate decides whether we publish a score; we still return the oriented
  // z's so the UI can show "available components" while Recovery is locked.
  let gatedReason: RecoveryGateReason | undefined;
  if (hrvState.count === 0) gatedReason = "no-hrv-history";
  else if (hrvState.count < HRV_MIN_NIGHTS)
    gatedReason = "insufficient-hrv-history";
  else if (inputs.hrvTonight == null || !(inputs.hrvTonight > 0))
    gatedReason = "no-hrv-tonight";

  const hrvZ =
    inputs.hrvTonight != null && inputs.hrvTonight > 0
      ? zScore(inputs.hrvTonight, hrvState, { ln: true })
      : 0;

  const components: RecoveryComponents = { hrvZ, rhrZ, brZ, sleepZ };

  if (gatedReason) {
    return {
      score: null,
      band: null,
      components,
      weights,
      s: null,
      gatedReason,
    };
  }

  const s =
    weights.hrv * hrvZ +
    weights.rhr * rhrZ +
    weights.br * brZ +
    weights.sleep * sleepZ;
  const score = Math.round(100 * standardNormalCdf(s));

  return { score, band: bandFor(score), components, weights, s };
}
