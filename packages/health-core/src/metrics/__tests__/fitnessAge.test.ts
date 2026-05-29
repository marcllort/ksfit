import { describe, it, expect } from "vitest";
import {
  computeFitnessAge,
  ageForVo2max,
  MEDIAN_VO2MAX_NORMS,
} from "../fitnessAge";

describe("ageForVo2max", () => {
  it("maps a knot's VO2max back to that knot's age", () => {
    for (const sex of ["male", "female"] as const) {
      for (const knot of MEDIAN_VO2MAX_NORMS[sex]) {
        expect(ageForVo2max(knot.vo2max, sex)).toBeCloseTo(knot.age, 6);
      }
    }
  });

  it("interpolates between knots", () => {
    // male: midpoint VO2max between 48@25 and 43@35 → ~30
    const mid = (48 + 43) / 2;
    expect(ageForVo2max(mid, "male")).toBeCloseTo(30, 5);
  });

  it("very high fitness clamps to the age floor (18)", () => {
    expect(ageForVo2max(200, "male")).toBe(18);
  });

  it("very low fitness clamps to the age ceiling (90)", () => {
    expect(ageForVo2max(1, "male")).toBe(90);
  });

  it("is monotonic: higher VO2max → younger fitness age", () => {
    const young = ageForVo2max(46, "female");
    const old = ageForVo2max(28, "female");
    expect(young).toBeLessThan(old);
  });
});

describe("computeFitnessAge (device path)", () => {
  it("maps device VO2max to a fitness age and pace-of-aging", () => {
    const r = computeFitnessAge({
      vo2max: 43,
      profile: { age: 45, sex: "male" },
    });
    expect(r.method).toBe("vo2max_norms");
    expect(r.fitnessAge).toBeCloseTo(35, 5); // 43 is the male 35yo median
    expect(r.paceOfAging).toBeCloseTo(35 - 45, 5); // −10, "younger than your years"
    expect(r.confidence).toBe("moderate");
    expect(r.label).toBe("Fitness Age (cardiorespiratory)");
  });

  it("paceOfAging is null when chronological age is unknown", () => {
    const r = computeFitnessAge({ vo2max: 43, profile: { sex: "male" } });
    expect(r.fitnessAge).not.toBeNull();
    expect(r.paceOfAging).toBeNull();
  });

  it("requires sex for the norm table", () => {
    const r = computeFitnessAge({
      vo2max: 43,
      profile: { age: 45, sex: "unspecified" },
    });
    expect(r.fitnessAge).toBeNull();
    expect(r.confidence).toBe("unavailable");
    expect(r.reason).toMatch(/sex/i);
  });
});

describe("computeFitnessAge (fallback is blocked)", () => {
  it("returns null + a reason when there is no device VO2max", () => {
    const r = computeFitnessAge({
      profile: { age: 45, sex: "male", waistCm: 90 },
      restingHr: 60,
      allowNonExerciseFallback: true,
    });
    expect(r.fitnessAge).toBeNull();
    expect(r.vo2max).toBeNull();
    expect(r.method).toBe("non_exercise_regression");
    expect(r.confidence).toBe("unavailable");
    expect(r.reason).toMatch(/Nes 2011|HUNT|verified/i);
  });

  it("treats non-positive VO2max as missing → blocked fallback", () => {
    const r = computeFitnessAge({ vo2max: 0, profile: { age: 30, sex: "male" } });
    expect(r.method).toBe("non_exercise_regression");
    expect(r.fitnessAge).toBeNull();
  });
});
