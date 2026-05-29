import { describe, it, expect } from "vitest";
import type { Exercise, HeartRatePoint } from "../../types";
import {
  computeStress,
  exerciseWindows,
  STRESS_CALIBRATION_DAYS,
  type ExclusionWindow,
} from "../stress";

function flatSeries(bpm: number, minutes: number, t0 = 0): HeartRatePoint[] {
  return Array.from({ length: minutes }, (_, i) => ({ t: t0 + i * 60000, bpm }));
}

describe("computeStress", () => {
  it("is 0 at resting HR", () => {
    const r = computeStress({
      intraday: flatSeries(50, 60),
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.index).toBe(0);
    expect(r.elevatedPct).toBe(0);
    expect(r.bucket).toBe("low");
  });

  it("index = 100·mean(arousal); HRR=0.5 → index 50", () => {
    // HR = rest + 0.5·reserve = 50 + 0.5·130 = 115
    const r = computeStress({
      intraday: flatSeries(115, 30),
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.index).toBeCloseTo(50, 6);
    expect(r.minutes).toBe(30);
  });

  it("elevatedPct counts minutes with arousal > 0.30", () => {
    // half the minutes at arousal 0.5 (>0.3), half at 0.1 (<0.3)
    const high = flatSeries(115, 10, 0); // arousal 0.5
    const low = flatSeries(63, 10, 10 * 60000); // arousal 0.1
    const r = computeStress({
      intraday: [...high, ...low],
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.elevatedPct).toBeCloseTo(50, 6);
  });

  it("excludes exercise windows", () => {
    const intraday = flatSeries(170, 60); // all elevated
    const exclude: ExclusionWindow[] = [{ startMs: 0, endMs: 60 * 60000 }];
    const r = computeStress({
      intraday,
      restingHr: 50,
      hrMax: 180,
      exclude,
    });
    expect(r.minutes).toBe(0);
    expect(r.index).toBe(0);
  });

  it("excludes a sleep window", () => {
    const intraday = flatSeries(120, 20);
    const r = computeStress({
      intraday,
      restingHr: 50,
      hrMax: 180,
      sleepWindow: { startMs: 0, endMs: 10 * 60000 },
    });
    expect(r.minutes).toBe(10);
  });

  it("returns 0 with degenerate reserve", () => {
    const r = computeStress({
      intraday: flatSeries(120, 30),
      restingHr: 180,
      hrMax: 180,
    });
    expect(r.index).toBe(0);
    expect(r.minutes).toBe(0);
  });

  it("uses fixed cuts while calibrating (<30d history)", () => {
    const r = computeStress({
      intraday: flatSeries(115, 30),
      restingHr: 50,
      hrMax: 180,
      indexHistory: Array(5).fill(10),
    });
    expect(r.calibrating).toBe(true);
    expect(r.bucket).toBe("high"); // index 50 > fallback high cut 40
  });

  it("uses personal terciles once calibrated", () => {
    const history = Array.from({ length: STRESS_CALIBRATION_DAYS }, (_, i) => i); // 0..29
    const r = computeStress({
      intraday: flatSeries(115, 30), // index ~50, above the 2/3 tercile of 0..29
      restingHr: 50,
      hrMax: 180,
      indexHistory: history,
    });
    expect(r.calibrating).toBe(false);
    expect(r.bucket).toBe("high");
  });

  it("carries the honest label", () => {
    const r = computeStress({
      intraday: flatSeries(60, 5),
      restingHr: 50,
      hrMax: 180,
    });
    expect(r.label).toBe("Stress (HR-based estimate)");
  });
});

describe("exerciseWindows", () => {
  it("maps exercises to [start, start+duration) ms", () => {
    const ex: Exercise[] = [
      {
        id: "1",
        startTime: new Date(1_000_000),
        durationSec: 600,
        type: "Run",
        source: "auto",
      },
    ];
    const [w] = exerciseWindows(ex);
    expect(w!.startMs).toBe(1_000_000);
    expect(w!.endMs).toBe(1_000_000 + 600_000);
  });
});
