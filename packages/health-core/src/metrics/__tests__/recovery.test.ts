import { describe, it, expect } from "vitest";
import type { HrvReading } from "../../types";
import {
  computeRecovery,
  DEFAULT_RECOVERY_WEIGHTS,
  RECOVERY_BASELINE_SPAN,
  type RecoveryInputs,
} from "../recovery";
import { HRV_MIN_NIGHTS } from "../hrv";

function hrvNights(values: number[]): HrvReading[] {
  return values.map((rmssd, i) => ({
    date: `2026-03-${String(i + 1).padStart(2, "0")}`,
    rmssd,
  }));
}

const baseHistory = hrvNights(Array(HRV_MIN_NIGHTS + 2).fill(50));
const rhrHistory = Array(30).fill(55);
const brHistory = Array(30).fill(15);

function inputs(overrides: Partial<RecoveryInputs> = {}): RecoveryInputs {
  return {
    hrvTonight: 50,
    hrvHistory: baseHistory,
    restingHrTonight: 55,
    restingHrHistory: rhrHistory,
    breathingTonight: 15,
    breathingHistory: brHistory,
    sleepPerformance: 100,
    ...overrides,
  };
}

describe("computeRecovery gating", () => {
  it("gates with no-hrv-history when history is empty", () => {
    const r = computeRecovery(inputs({ hrvHistory: [] }));
    expect(r.score).toBeNull();
    expect(r.gatedReason).toBe("no-hrv-history");
  });

  it("gates with insufficient-hrv-history below the minimum", () => {
    const r = computeRecovery(
      inputs({ hrvHistory: hrvNights(Array(HRV_MIN_NIGHTS - 1).fill(50)) }),
    );
    expect(r.score).toBeNull();
    expect(r.gatedReason).toBe("insufficient-hrv-history");
  });

  it("gates with no-hrv-tonight when tonight's reading is missing", () => {
    const r = computeRecovery(inputs({ hrvTonight: null }));
    expect(r.score).toBeNull();
    expect(r.gatedReason).toBe("no-hrv-tonight");
  });

  it("still returns oriented components while gated (for the UI)", () => {
    const r = computeRecovery(inputs({ hrvHistory: [] }));
    expect(r.components).toBeDefined();
    expect(r.weights).toEqual(DEFAULT_RECOVERY_WEIGHTS);
  });
});

describe("computeRecovery scoring", () => {
  it("scores 50 when every signal is exactly at baseline (S=0 → Φ(0)=0.5)", () => {
    // perfectly flat histories ⇒ sd~0 ⇒ z=0; sleep=100 ⇒ sleepZ=0
    const r = computeRecovery(inputs());
    expect(r.gatedReason).toBeUndefined();
    expect(r.s).toBeCloseTo(0, 6);
    expect(r.score).toBe(50);
    expect(r.band).toBe("yellow");
  });

  it("higher HRV than baseline raises the score (green)", () => {
    const varied = hrvNights([
      40, 60, 45, 55, 50, 48, 52, 47, 53, 49, 51, 46, 54, 50, 50, 50,
    ]);
    const r = computeRecovery(
      inputs({ hrvHistory: varied, hrvTonight: 90 }),
    );
    expect(r.score!).toBeGreaterThan(50);
    expect(r.components.hrvZ).toBeGreaterThan(0);
  });

  it("lower RHR than baseline raises the score (sign inverted)", () => {
    const rhrVaried = [50, 60, 52, 58, 54, 56, 53, 57, 55, 51, 59, 50, 60, 55];
    const r = computeRecovery(
      inputs({ restingHrHistory: rhrVaried, restingHrTonight: 40 }),
    );
    expect(r.components.rhrZ).toBeGreaterThan(0); // low RHR → positive contribution
  });

  it("poor sleep performance lowers the score (red end)", () => {
    const r = computeRecovery(inputs({ sleepPerformance: 40 }));
    // (40-100)/15 = -4, clamped to the documented [-3,3] z-score range.
    expect(r.components.sleepZ).toBeCloseTo(-3, 6);
    expect(r.score!).toBeLessThan(50);
  });

  it("missing RHR/BR/sleep contribute 0 (treated as at-baseline)", () => {
    const r = computeRecovery(
      inputs({
        restingHrTonight: null,
        breathingTonight: null,
        sleepPerformance: null,
      }),
    );
    expect(r.components.rhrZ).toBe(0);
    expect(r.components.brZ).toBe(0);
    expect(r.components.sleepZ).toBe(0);
  });

  it("band thresholds: green>=67, yellow 34-66, red<=33", () => {
    // drive S strongly positive / negative via sleepZ
    const green = computeRecovery(
      inputs({ sleepPerformance: 145, weights: { hrv: 0, rhr: 0, br: 0, sleep: 1 } }),
    );
    expect(green.band).toBe("green");
    const red = computeRecovery(
      inputs({ sleepPerformance: 55, weights: { hrv: 0, rhr: 0, br: 0, sleep: 1 } }),
    );
    expect(red.band).toBe("red");
  });

  it("uses the documented default weights", () => {
    expect(DEFAULT_RECOVERY_WEIGHTS).toEqual({
      hrv: 0.5,
      rhr: 0.25,
      br: 0.1,
      sleep: 0.15,
    });
    expect(RECOVERY_BASELINE_SPAN).toBe(30);
  });
});
