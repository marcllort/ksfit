/**
 * Day Strain 0–21 (04-FEATURES §2).
 *
 * Banister TRIMP with Heart-Rate-Reserve exponential weighting, summed per
 * minute of intraday HR:
 *   HRR(t) = clamp((HR(t) − HRrest)/(HRmax − HRrest), 0, 1)
 *   w(t)   = HRR · 0.64 · e^(1.92·HRR)   // male
 *            HRR · 0.86 · e^(1.67·HRR)   // female
 *   TRIMP  = Σ Δt_min · w(t)
 *
 * Then log-mapped to 0–21, self-calibrated to the user's own 90-day TRIMP
 * distribution so a "14" means "high relative to your own 90 days", not vs a
 * population curve:
 *   L      = ln(1 + TRIMP)
 *   L_p95  = 95th percentile of L over the trailing 90 days  (the "all-out" ref)
 *   strain = 21 · clamp(L / L_p95, 0, 1)
 *
 * Until ~14 days of history exist we fall back to a fixed reference
 * (L_p95 = ln(1 + 300)) and tag the value "calibrating".
 *
 * HRmax is age-derived (Tanaka: 208 − 0.7·age) unless an explicit override is
 * given (e.g. a measured max from the profile).
 */
import type { HeartRatePoint, UserProfile } from "../types";
import { clamp, percentile } from "./baseline";

/** Days of TRIMP history used to self-calibrate the 0–21 scale. */
export const STRAIN_CALIBRATION_DAYS = 90;
/** Minimum history days before we trust the personal p95; else "calibrating". */
export const STRAIN_MIN_HISTORY = 14;
/** Fixed fallback p95 of L while calibrating: ln(1 + 300). */
export const STRAIN_FALLBACK_LP95 = Math.log(1 + 300);
/** Tanaka HRmax intercept/slope. */
const TANAKA_INTERCEPT = 208;
const TANAKA_SLOPE = 0.7;

export interface BanisterCoeffs {
  a: number;
  b: number;
}

/** Banister weighting constants by sex (04-FEATURES §2). */
export const BANISTER: Record<"male" | "female", BanisterCoeffs> = {
  male: { a: 0.64, b: 1.92 },
  female: { a: 0.86, b: 1.67 },
};

/** Tanaka age-predicted HRmax. */
export function hrMaxFromAge(age: number): number {
  return TANAKA_INTERCEPT - TANAKA_SLOPE * age;
}

/**
 * Resolve HRmax: explicit override wins, else Tanaka from age. Returns null if
 * neither is available (caller can't compute strain honestly without it).
 */
export function resolveHrMax(
  profile: Pick<UserProfile, "age"> & { hrMaxOverride?: number | null },
): number | null {
  if (profile.hrMaxOverride != null && profile.hrMaxOverride > 0) {
    return profile.hrMaxOverride;
  }
  if (profile.age != null && profile.age > 0) return hrMaxFromAge(profile.age);
  return null;
}

export interface TrimpInputs {
  intraday: readonly HeartRatePoint[];
  restingHr: number;
  hrMax: number;
  sex?: UserProfile["sex"];
}

export interface TrimpResult {
  trimp: number;
  /** Minutes of usable intraday HR folded in (a coverage proxy). */
  minutes: number;
}

/**
 * Banister TRIMP from an intraday HR series. Each point contributes the HRR
 * weight for its 1-minute bin; we derive Δt from consecutive sample gaps
 * (clamped to ≤2 min so a long gap doesn't over-credit a single sample), so
 * sparse days simply accumulate less — they are under-counted, by design, and
 * the caller surfaces a coverage indicator (04-FEATURES §2).
 */
export function computeTrimp(inputs: TrimpInputs): TrimpResult {
  const { intraday, restingHr, hrMax } = inputs;
  const reserve = hrMax - restingHr;
  const sex = inputs.sex === "female" ? "female" : "male";
  const { a, b } = BANISTER[sex];

  if (!(reserve > 0) || intraday.length === 0) {
    return { trimp: 0, minutes: 0 };
  }

  const points = intraday
    .filter((p) => Number.isFinite(p.t) && Number.isFinite(p.bpm))
    .slice()
    .sort((p, q) => p.t - q.t);

  let trimp = 0;
  let minutes = 0;
  for (let i = 0; i < points.length; i++) {
    const p = points[i]!;
    // Δt = gap to the next sample, in minutes, clamped to [0, 2]. Last sample
    // gets a 1-minute bin (Fitbit intraday is 1-min granularity).
    let dtMin = 1;
    if (i < points.length - 1) {
      dtMin = clamp((points[i + 1]!.t - p.t) / 60000, 0, 2);
    }
    const hrr = clamp((p.bpm - restingHr) / reserve, 0, 1);
    const w = hrr * a * Math.exp(b * hrr);
    trimp += dtMin * w;
    minutes += dtMin;
  }

  return { trimp, minutes };
}

export interface StrainInputs extends TrimpInputs {
  /** Trailing daily TRIMP values (this day excluded), any order. */
  trimpHistory: readonly number[];
}

export interface StrainResult {
  /** 0–21. */
  strain: number;
  /** Raw Banister TRIMP for the day. */
  trimp: number;
  minutes: number;
  /** L = ln(1 + TRIMP). */
  l: number;
  /** The p95 of L used for the map (personal or fallback). */
  lP95: number;
  /** True while using the fixed fallback reference (history < 14 days). */
  calibrating: boolean;
  /** History days available for calibration. */
  historyDays: number;
}

/**
 * Full Day Strain: TRIMP → log-map → 0–21, self-calibrated to the user's own
 * 90-day L distribution (or the fixed fallback while calibrating).
 */
export function computeStrain(inputs: StrainInputs): StrainResult {
  const { trimp, minutes } = computeTrimp(inputs);
  const l = Math.log(1 + trimp);

  const history = inputs.trimpHistory
    .filter((v) => Number.isFinite(v) && v >= 0)
    .slice(-STRAIN_CALIBRATION_DAYS);
  const historyDays = history.length;
  const calibrating = historyDays < STRAIN_MIN_HISTORY;

  let lP95: number;
  if (calibrating) {
    lP95 = STRAIN_FALLBACK_LP95;
  } else {
    const lSeries = history.map((t) => Math.log(1 + t));
    const p = percentile(lSeries, 0.95);
    // Guard a degenerate all-zero history.
    lP95 = p > 1e-9 ? p : STRAIN_FALLBACK_LP95;
  }

  const strain = 21 * clamp(l / lP95, 0, 1);

  return { strain, trimp, minutes, l, lP95, calibrating, historyDays };
}
