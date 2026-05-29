import { describe, it, expect } from "vitest";
import {
  computeBaselineNeed,
  computeSleepNeed,
  computeSleepPerformance,
  computeSleepDebt,
  sleepRecommendations,
  INIT_BASELINE_NEED_MIN,
  DEBT_RECOVERY_ALPHA,
  STRAIN_NEED_SLOPE_MIN,
  STRAIN_NEED_THRESHOLD,
} from "../sleep";

describe("computeBaselineNeed", () => {
  it("returns the init when there is no well-rested history", () => {
    expect(computeBaselineNeed([])).toBe(INIT_BASELINE_NEED_MIN);
    expect(computeBaselineNeed([300, 350])).toBe(INIT_BASELINE_NEED_MIN); // below floor
  });
  it("pulls toward well-rested nights but stays anchored by the init", () => {
    const need = computeBaselineNeed(Array(20).fill(450));
    expect(need).toBeGreaterThan(450);
    expect(need).toBeLessThan(INIT_BASELINE_NEED_MIN);
  });
});

describe("computeSleepNeed", () => {
  it("equals baseline when no debt, no strain, no nap", () => {
    const r = computeSleepNeed({ baselineNeed: 480, currentDebt: 0 });
    expect(r.need).toBe(480);
    expect(r.debt).toBe(0);
    expect(r.strainAdj).toBe(0);
  });

  it("adds α·debt", () => {
    const r = computeSleepNeed({ baselineNeed: 480, currentDebt: 120 });
    expect(r.debt).toBeCloseTo(DEBT_RECOVERY_ALPHA * 120, 9);
    expect(r.need).toBeCloseTo(480 + 60, 9);
  });

  it("adds β·(strain−10)·6 only above the threshold", () => {
    const none = computeSleepNeed({
      baselineNeed: 480,
      currentDebt: 0,
      priorStrain: 8,
    });
    expect(none.strainAdj).toBe(0);

    const over = computeSleepNeed({
      baselineNeed: 480,
      currentDebt: 0,
      priorStrain: 15,
    });
    expect(over.strainAdj).toBeCloseTo(
      (15 - STRAIN_NEED_THRESHOLD) * STRAIN_NEED_SLOPE_MIN,
      9,
    );
  });

  it("credits naps and floors at 0", () => {
    const r = computeSleepNeed({
      baselineNeed: 480,
      currentDebt: 0,
      napMin: 30,
    });
    expect(r.napCredit).toBe(30);
    expect(r.need).toBe(450);

    const floored = computeSleepNeed({
      baselineNeed: 100,
      currentDebt: 0,
      napMin: 9999,
    });
    expect(floored.need).toBe(0);
  });

  it("breakdown sums to need", () => {
    const r = computeSleepNeed({
      baselineNeed: 470,
      currentDebt: 100,
      priorStrain: 14,
      napMin: 20,
    });
    expect(r.baseline + r.debt + r.strainAdj - r.napCredit).toBeCloseTo(
      r.need,
      9,
    );
  });
});

describe("computeSleepPerformance", () => {
  it("rounds 100·asleep/need", () => {
    expect(computeSleepPerformance(420, 480)).toBe(88);
  });
  it("caps at 100 by default, uncapped on request", () => {
    expect(computeSleepPerformance(600, 480)).toBe(100);
    expect(computeSleepPerformance(600, 480, false)).toBe(125);
  });
  it("returns 0 when need is non-positive", () => {
    expect(computeSleepPerformance(400, 0)).toBe(0);
  });
});

describe("computeSleepDebt", () => {
  it("is 0 when every night meets need", () => {
    const debt = computeSleepDebt([
      { needMin: 480, asleepMin: 500 },
      { needMin: 480, asleepMin: 480 },
    ]);
    expect(debt).toBe(0);
  });

  it("decays geometrically: last night full, prior half, etc.", () => {
    const debt = computeSleepDebt([
      { needMin: 480, asleepMin: 380 }, // shortfall 100, weight 1
      { needMin: 480, asleepMin: 430 }, // shortfall 50, weight 0.5
      { needMin: 480, asleepMin: 400 }, // shortfall 80, weight 0.25
    ]);
    expect(debt).toBeCloseTo(100 + 0.5 * 50 + 0.25 * 80, 9);
  });

  it("only counts the first 5 nights", () => {
    const sixNights = Array(6).fill({ needMin: 480, asleepMin: 380 });
    const debt = computeSleepDebt(sixNights);
    const expected =
      100 * (1 + 0.5 + 0.25 + 0.125 + 0.0625); // 5 terms
    expect(debt).toBeCloseTo(expected, 9);
  });

  it("never goes negative (oversleep doesn't bank credit)", () => {
    const debt = computeSleepDebt([{ needMin: 480, asleepMin: 600 }]);
    expect(debt).toBe(0);
  });
});

describe("sleepRecommendations", () => {
  it("flags a short night under 70% performance", () => {
    const recs = sleepRecommendations({
      performance: 60,
      needMin: 480,
      asleepMin: 360,
      debtMin: 0,
    });
    expect(recs.some((r) => r.kind === "short")).toBe(true);
  });
  it("flags carried debt over 60 min", () => {
    const recs = sleepRecommendations({
      performance: 95,
      needMin: 480,
      asleepMin: 470,
      debtMin: 90,
    });
    expect(recs.some((r) => r.kind === "debt")).toBe(true);
  });
  it("flags fragmented sleep under 85% efficiency", () => {
    const recs = sleepRecommendations({
      performance: 95,
      needMin: 480,
      asleepMin: 470,
      debtMin: 0,
      efficiency: 80,
    });
    expect(recs.some((r) => r.kind === "fragmented")).toBe(true);
  });
  it("returns nothing for a good night", () => {
    const recs = sleepRecommendations({
      performance: 98,
      needMin: 480,
      asleepMin: 475,
      debtMin: 10,
      efficiency: 92,
    });
    expect(recs).toHaveLength(0);
  });
});
