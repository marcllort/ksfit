/**
 * Fitness age (cardiorespiratory) — VO2max vs age/sex norms (04-FEATURES §6).
 *
 * Explicitly NOT biological/epigenetic age and NOT WHOOP's "pace of aging".
 * It is a VO2max-vs-norms mapping (HUNT method):
 *   fitnessAge  = the age at which the user's VO2max equals the population
 *                 MEDIAN (50th pct) VO2max for their sex.
 *   paceOfAging = fitnessAge − chronologicalAge   (negative = younger)
 *
 * Two paths:
 *   - PRIMARY (preferred): device VO2max (`getCardioScore`) → norm-table lookup.
 *   - FALLBACK: non-exercise regression (Nes 2011 / HUNT) from sex, age, waist,
 *     resting HR, PA index. The Nes 2011 coefficients are UNVERIFIED in our
 *     research — see the hard TODO below. The fallback stays BLOCKED until they
 *     are pulled from the primary paper; it returns null + a clear reason.
 */
import type { UserProfile } from "../types";
import { clamp } from "./baseline";

export type FitnessAgeMethod = "vo2max_norms" | "non_exercise_regression";
export type FitnessAgeConfidence = "moderate" | "low" | "unavailable";

export interface FitnessAgeResult {
  /** Mapped cardiorespiratory fitness age (years), null when uncomputable. */
  fitnessAge: number | null;
  /** fitnessAge − chronologicalAge; negative = "younger than your years". */
  paceOfAging: number | null;
  /** VO2max used (ml/kg/min), null when neither path produced one. */
  vo2max: number | null;
  method: FitnessAgeMethod;
  confidence: FitnessAgeConfidence;
  /** Honest label literal callers must surface. */
  label: "Fitness Age (cardiorespiratory)";
  /** Set when a value is withheld (e.g. fallback blocked, missing inputs). */
  reason?: string;
}

/**
 * INTERIM median-VO2max norm table (ml/kg/min) by sex and age bucket.
 *
 * TODO(HUNT/Nes-2011): these are reasonable interim placeholders for the *50th
 * percentile* drawn from commonly-cited ACSM/FRIEND-style age-sex norms; they
 * are NOT the verified Nes 2011 (HUNT) values. Before this ships as anything
 * but "rough estimate", replace this table (and add the regression below) with
 * coefficients pulled from the PRIMARY paper:
 *   Nes BM et al. "Estimating V̇O2peak from a nonexercise prediction model:
 *   the HUNT Study, Norway." Med Sci Sports Exerc. 2011.
 * Keep the sex-specific, age-decreasing shape; verify the exact knots.
 *
 * Each entry is the midpoint age of the bucket → median VO2max at that age.
 * We linearly interpolate/extrapolate between knots when inverting.
 */
export const MEDIAN_VO2MAX_NORMS: Record<
  "male" | "female",
  ReadonlyArray<{ age: number; vo2max: number }>
> = {
  // INTERIM PLACEHOLDER — verify against the HUNT primary source before relying on it.
  male: [
    { age: 25, vo2max: 48 },
    { age: 35, vo2max: 43 },
    { age: 45, vo2max: 39 },
    { age: 55, vo2max: 34 },
    { age: 65, vo2max: 30 },
    { age: 75, vo2max: 26 },
  ],
  female: [
    { age: 25, vo2max: 41 },
    { age: 35, vo2max: 37 },
    { age: 45, vo2max: 33 },
    { age: 55, vo2max: 29 },
    { age: 65, vo2max: 26 },
    { age: 75, vo2max: 23 },
  ],
};

const AGE_FLOOR = 18;
const AGE_CEIL = 90;

/**
 * Invert the (age → median VO2max) curve: find the age whose median VO2max
 * equals `vo2max`. The curve is monotonically decreasing, so we walk adjacent
 * knots and linearly interpolate; beyond the ends we linearly extrapolate using
 * the nearest segment slope, then clamp to [AGE_FLOOR, AGE_CEIL].
 */
export function ageForVo2max(
  vo2max: number,
  sex: "male" | "female",
): number {
  const knots = MEDIAN_VO2MAX_NORMS[sex];

  // Above the youngest knot's fitness → at least as young as the floor.
  if (vo2max >= knots[0]!.vo2max) {
    const a = knots[0]!;
    const b = knots[1]!;
    const slope = (b.vo2max - a.vo2max) / (b.age - a.age); // negative
    const age = a.age + (vo2max - a.vo2max) / slope;
    return clamp(age, AGE_FLOOR, AGE_CEIL);
  }
  const last = knots[knots.length - 1]!;
  if (vo2max <= last.vo2max) {
    const a = knots[knots.length - 2]!;
    const b = last;
    const slope = (b.vo2max - a.vo2max) / (b.age - a.age);
    const age = b.age + (vo2max - b.vo2max) / slope;
    return clamp(age, AGE_FLOOR, AGE_CEIL);
  }
  // Interior: find the bracketing segment (vo2max decreasing with age).
  for (let i = 0; i < knots.length - 1; i++) {
    const a = knots[i]!;
    const b = knots[i + 1]!;
    if (vo2max <= a.vo2max && vo2max >= b.vo2max) {
      const frac = (vo2max - a.vo2max) / (b.vo2max - a.vo2max);
      return clamp(a.age + frac * (b.age - a.age), AGE_FLOOR, AGE_CEIL);
    }
  }
  // Unreachable given the guards above; clamp defensively.
  return clamp(last.age, AGE_FLOOR, AGE_CEIL);
}

export interface FitnessAgeInputs {
  /** Device VO2max (ml/kg/min) from getCardioScore; preferred input. */
  vo2max?: number | null;
  profile: Pick<UserProfile, "age" | "sex" | "waistCm">;
  /** Resting HR — only used by the (currently blocked) regression fallback. */
  restingHr?: number | null;
  /**
   * Opt-in escape hatch for the non-exercise fallback. Even when true it stays
   * blocked until the Nes 2011 coefficients are verified; this flag only lets a
   * future verified implementation light up without a signature change.
   */
  allowNonExerciseFallback?: boolean;
}

/**
 * Compute cardiorespiratory fitness age. Prefers the device-VO2max path; the
 * non-exercise regression fallback is intentionally BLOCKED (returns null with
 * a reason) until the HUNT coefficients are verified.
 */
export function computeFitnessAge(inputs: FitnessAgeInputs): FitnessAgeResult {
  const { profile } = inputs;
  const sex =
    profile.sex === "male" || profile.sex === "female" ? profile.sex : null;
  const base = {
    label: "Fitness Age (cardiorespiratory)" as const,
  };

  // PRIMARY: device VO2max + norm inversion.
  if (inputs.vo2max != null && inputs.vo2max > 0) {
    if (!sex) {
      return {
        ...base,
        fitnessAge: null,
        paceOfAging: null,
        vo2max: inputs.vo2max,
        method: "vo2max_norms",
        confidence: "unavailable",
        reason: "sex required for sex-specific norm table",
      };
    }
    const fitnessAge = ageForVo2max(inputs.vo2max, sex);
    const paceOfAging =
      profile.age != null ? fitnessAge - profile.age : null;
    return {
      ...base,
      fitnessAge,
      paceOfAging,
      vo2max: inputs.vo2max,
      method: "vo2max_norms",
      // Device VO2max is itself an estimate → moderate at best.
      confidence: "moderate",
    };
  }

  // FALLBACK: non-exercise regression — BLOCKED pending coefficient verification.
  // TODO(HUNT/Nes-2011): implement once coefficients are pulled from the primary
  // paper. Until then we never fabricate a VO2max from waist/RHR.
  return {
    ...base,
    fitnessAge: null,
    paceOfAging: null,
    vo2max: null,
    method: "non_exercise_regression",
    confidence: "unavailable",
    reason:
      "no device VO2max; non-exercise (Nes 2011/HUNT) fallback is blocked until coefficients are verified against the primary paper",
  };
}
