/**
 * Sleep Need / Performance / decaying sleep debt (04-FEATURES §3).
 *
 * Stage data + efficiency are direct from the provider (no derivation). What we
 * derive — and label as our model with our coefficients — is:
 *
 *   need = baselineNeed + debtComponent + strainComponent − napCredit
 *     baselineNeed    = personal EWMA of asleepMin on well-rested nights, init 480
 *     debtComponent   = α · currentSleepDebt        α = 0.50  (recover half the debt)
 *     strainComponent = β · max(0, strain − 10)·6   β = 1.0   (~6 min per strain pt >10)
 *     napCredit       = today's logged nap minutes
 *
 *   sleepPerformance = round(100 · asleepMin / need)     // display-capped at 100
 *
 *   sleep debt — decaying 5-night accumulator:
 *     nightlyShortfall(d) = max(0, need(d) − asleepMin(d))
 *     debt = Σ_{i=0..4} decay^i · nightlyShortfall(d − i)    decay = 0.5
 */
import { clamp, ewma } from "./baseline";

/** Initial baseline need before any history (minutes ≈ 8h). */
export const INIT_BASELINE_NEED_MIN = 480;
/** EWMA span (nights) for the personal baseline-need. */
export const NEED_BASELINE_SPAN = 14;
/** α — fraction of running debt added back into tonight's need. */
export const DEBT_RECOVERY_ALPHA = 0.5;
/** β — strain-need slope multiplier. */
export const STRAIN_NEED_BETA = 1.0;
/** Minutes of extra need per strain point above the threshold. */
export const STRAIN_NEED_SLOPE_MIN = 6;
/** Strain value above which extra sleep need accrues. */
export const STRAIN_NEED_THRESHOLD = 10;
/** Nights in the debt window. */
export const SLEEP_DEBT_NIGHTS = 5;
/** Geometric decay applied per night back in the debt window. */
export const SLEEP_DEBT_DECAY = 0.5;
/** "Well-rested" floor: nights with at least this asleepMin seed the baseline. */
export const WELL_RESTED_MIN = 420;

/**
 * Personal baseline need: EWMA of asleepMin over the trailing well-rested
 * nights, initialized to 480 min. We prepend the init so a short / poor
 * history still pulls toward 8h rather than toward a chronically-short user's
 * own deficit.
 */
export function computeBaselineNeed(
  asleepHistory: readonly number[],
  init = INIT_BASELINE_NEED_MIN,
): number {
  const wellRested = asleepHistory.filter(
    (m) => Number.isFinite(m) && m >= WELL_RESTED_MIN,
  );
  if (wellRested.length === 0) return init;
  const state = ewma([init, ...wellRested], { span: NEED_BASELINE_SPAN });
  return state.mean;
}

export interface SleepNeedInputs {
  /** Personal baseline need (min); compute via computeBaselineNeed. */
  baselineNeed: number;
  /** Current running sleep debt (min) from computeSleepDebt. */
  currentDebt: number;
  /** Prior day's Day Strain 0–21 (drives extra need). */
  priorStrain?: number | null;
  /** Today's logged nap minutes (credited against need). */
  napMin?: number;
  alpha?: number;
  beta?: number;
}

export interface SleepNeedBreakdown {
  baseline: number;
  debt: number;
  strainAdj: number;
  napCredit: number;
  /** Total need (min), floored at 0. */
  need: number;
}

/** Dynamic sleep need with an itemized, transparent breakdown. */
export function computeSleepNeed(inputs: SleepNeedInputs): SleepNeedBreakdown {
  const alpha = inputs.alpha ?? DEBT_RECOVERY_ALPHA;
  const beta = inputs.beta ?? STRAIN_NEED_BETA;
  const baseline = inputs.baselineNeed;
  const debt = alpha * Math.max(0, inputs.currentDebt);
  const strain = inputs.priorStrain ?? 0;
  const strainAdj =
    beta * Math.max(0, strain - STRAIN_NEED_THRESHOLD) * STRAIN_NEED_SLOPE_MIN;
  const napCredit = Math.max(0, inputs.napMin ?? 0);
  const need = Math.max(0, baseline + debt + strainAdj - napCredit);
  return { baseline, debt, strainAdj, napCredit, need };
}

/**
 * Sleep performance %. `cap` (default true) clamps the displayed value at 100.
 * Returns 0 when need is non-positive (avoids div-by-zero).
 */
export function computeSleepPerformance(
  asleepMin: number,
  needMin: number,
  cap = true,
): number {
  if (!(needMin > 0)) return 0;
  const pct = Math.round((100 * asleepMin) / needMin);
  return cap ? Math.min(100, pct) : pct;
}

/** One night's contribution to the debt accumulator. */
export interface SleepDebtNight {
  needMin: number;
  asleepMin: number;
}

/**
 * Decaying 5-night sleep debt. `nights` is ordered newest → oldest (index 0 =
 * last night, counted full; index 1 = night before, weight 0.5; …). Only the
 * first SLEEP_DEBT_NIGHTS entries contribute.
 */
export function computeSleepDebt(
  nights: readonly SleepDebtNight[],
  decay = SLEEP_DEBT_DECAY,
): number {
  let debt = 0;
  const n = Math.min(nights.length, SLEEP_DEBT_NIGHTS);
  for (let i = 0; i < n; i++) {
    const { needMin, asleepMin } = nights[i]!;
    const shortfall = Math.max(0, needMin - asleepMin);
    debt += Math.pow(decay, i) * shortfall;
  }
  return debt;
}

export type SleepRecommendation =
  | { kind: "short"; shortfallMin: number }
  | { kind: "debt"; debtMin: number }
  | { kind: "fragmented"; efficiency: number };

/**
 * Deterministic, rule-based recommendations (NOT the LLM — 04-FEATURES §3).
 * Returns the set of triggered rules; the UI renders copy + suggested bedtime.
 */
export function sleepRecommendations(args: {
  performance: number;
  needMin: number;
  asleepMin: number;
  debtMin: number;
  efficiency?: number;
  wakeMin?: number;
}): SleepRecommendation[] {
  const recs: SleepRecommendation[] = [];
  if (args.performance < 70) {
    recs.push({
      kind: "short",
      shortfallMin: Math.max(0, args.needMin - args.asleepMin),
    });
  }
  if (args.debtMin > 60) {
    recs.push({ kind: "debt", debtMin: args.debtMin });
  }
  if (args.efficiency != null && args.efficiency < 85) {
    recs.push({ kind: "fragmented", efficiency: args.efficiency });
  }
  return recs;
}

/** Age-normal stage % context bands (adults). Context only, never diagnosis. */
export const STAGE_NORMAL_PCT = {
  deep: { low: 13, high: 23 },
  rem: { low: 20, high: 25 },
} as const;

/** Clamp helper re-export so callers needn't reach into baseline for it. */
export { clamp };
