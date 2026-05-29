import { describe, it, expect } from "vitest";
import type { HeartRatePoint } from "../../types";
import {
  computeStrain,
  computeTrimp,
  hrMaxFromAge,
  resolveHrMax,
  BANISTER,
  STRAIN_FALLBACK_LP95,
  STRAIN_MIN_HISTORY,
} from "../strain";

/** Build a 1-min intraday series at a constant bpm starting at t0. */
function flatSeries(bpm: number, minutes: number, t0 = 0): HeartRatePoint[] {
  return Array.from({ length: minutes }, (_, i) => ({
    t: t0 + i * 60000,
    bpm,
  }));
}

describe("hrMaxFromAge / resolveHrMax", () => {
  it("uses Tanaka 208 − 0.7·age", () => {
    expect(hrMaxFromAge(40)).toBeCloseTo(180, 6);
    expect(hrMaxFromAge(20)).toBeCloseTo(194, 6);
  });
  it("override wins over age", () => {
    expect(resolveHrMax({ age: 40, hrMaxOverride: 190 })).toBe(190);
  });
  it("falls back to age, then null", () => {
    expect(resolveHrMax({ age: 30 })).toBeCloseTo(187, 6);
    expect(resolveHrMax({})).toBeNull();
  });
});

describe("computeTrimp", () => {
  it("is 0 at resting HR (HRR=0)", () => {
    const r = computeTrimp({
      intraday: flatSeries(50, 60),
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.trimp).toBe(0);
    expect(r.minutes).toBe(60);
  });

  it("at HRmax (HRR=1), per-min weight = a·e^b (male)", () => {
    const { a, b } = BANISTER.male;
    const r = computeTrimp({
      intraday: flatSeries(180, 10),
      restingHr: 50,
      hrMax: 180,
    });
    // 10 minutes (last sample gets a 1-min bin) at weight a·e^b
    expect(r.trimp).toBeCloseTo(10 * a * Math.exp(b), 4);
  });

  it("female uses the female coefficients", () => {
    const { a, b } = BANISTER.female;
    const r = computeTrimp({
      intraday: flatSeries(180, 5),
      restingHr: 50,
      hrMax: 180,
      sex: "female",
    });
    expect(r.trimp).toBeCloseTo(5 * a * Math.exp(b), 4);
  });

  it("clamps HRR into [0,1] (above max counts as 1)", () => {
    const { a, b } = BANISTER.male;
    const r = computeTrimp({
      intraday: flatSeries(220, 3),
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.trimp).toBeCloseTo(3 * a * Math.exp(b), 4);
  });

  it("returns 0 with degenerate reserve or empty series", () => {
    expect(
      computeTrimp({ intraday: flatSeries(120, 5), restingHr: 180, hrMax: 180 })
        .trimp,
    ).toBe(0);
    expect(computeTrimp({ intraday: [], restingHr: 50, hrMax: 180 }).trimp).toBe(
      0,
    );
  });

  it("sparse samples are under-counted (gap clamped to 2 min)", () => {
    // two samples 30 min apart → first bin clamped to 2 min, last = 1 min
    const r = computeTrimp({
      intraday: [
        { t: 0, bpm: 180 },
        { t: 30 * 60000, bpm: 180 },
      ],
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.minutes).toBe(3); // 2 + 1
  });
});

describe("computeStrain", () => {
  const hard = {
    intraday: flatSeries(150, 60),
    restingHr: 50,
    hrMax: 180,
  };

  it("is 0 on a fully-resting day", () => {
    const r = computeStrain({
      intraday: flatSeries(50, 120),
      restingHr: 50,
      hrMax: 180,
      trimpHistory: Array(90).fill(100),
    });
    expect(r.strain).toBe(0);
  });

  it("calibrating below the history minimum, using the fixed fallback", () => {
    const r = computeStrain({ ...hard, trimpHistory: Array(5).fill(50) });
    expect(r.calibrating).toBe(true);
    expect(r.lP95).toBeCloseTo(STRAIN_FALLBACK_LP95, 9);
  });

  it("self-calibrates to the personal p95 once enough history exists", () => {
    const history = Array.from({ length: 90 }, (_, i) => i + 1); // TRIMP 1..90
    const r = computeStrain({ ...hard, trimpHistory: history });
    expect(r.calibrating).toBe(false);
    expect(r.lP95).toBeGreaterThan(0);
    expect(r.lP95).not.toBeCloseTo(STRAIN_FALLBACK_LP95, 6);
  });

  it("a day at the personal p95 maps near 21", () => {
    // craft a history whose p95 L equals this day's L
    const day = computeTrimp(hard).trimp;
    const history = Array(STRAIN_MIN_HISTORY + 5).fill(day);
    const r = computeStrain({ ...hard, trimpHistory: history });
    expect(r.strain).toBeCloseTo(21, 5);
  });

  it("clamps strain into [0,21] when the day exceeds the personal p95", () => {
    const history = Array(90).fill(5); // tiny reference
    const r = computeStrain({ ...hard, trimpHistory: history });
    expect(r.strain).toBeLessThanOrEqual(21);
    expect(r.strain).toBeGreaterThanOrEqual(0);
    expect(r.strain).toBeCloseTo(21, 6);
  });

  it("guards an all-zero history (falls back rather than div-by-zero)", () => {
    const r = computeStrain({ ...hard, trimpHistory: Array(90).fill(0) });
    expect(Number.isFinite(r.strain)).toBe(true);
    expect(r.lP95).toBeCloseTo(STRAIN_FALLBACK_LP95, 9);
  });
});
