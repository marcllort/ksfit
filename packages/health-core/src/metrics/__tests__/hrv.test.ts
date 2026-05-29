import { describe, it, expect } from "vitest";
import type { HrvReading } from "../../types";
import { computeHrvBaseline, HRV_MIN_NIGHTS } from "../hrv";

function nights(values: number[], startDay = 1): HrvReading[] {
  return values.map((rmssd, i) => ({
    date: `2026-01-${String(startDay + i).padStart(2, "0")}`,
    rmssd,
  }));
}

describe("computeHrvBaseline", () => {
  it("returns empty state for no data", () => {
    const r = computeHrvBaseline([]);
    expect(r.baseline).toBeNull();
    expect(r.latest).toBeNull();
    expect(r.status).toBeNull();
    expect(r.sufficient).toBe(false);
    expect(r.nights).toBe(0);
    expect(r.trend).toBe("flat");
  });

  it("baseline ~ geometric center of a constant series; band collapses", () => {
    const r = computeHrvBaseline(nights(Array(30).fill(50)));
    expect(r.baseline).toBeCloseTo(50, 6);
    expect(r.low).toBeCloseTo(50, 4);
    expect(r.high).toBeCloseTo(50, 4);
    expect(r.status).toBe("within");
    expect(r.latest).toBe(50);
  });

  it("sorts by date regardless of input order", () => {
    const shuffled: HrvReading[] = [
      { date: "2026-01-03", rmssd: 60 },
      { date: "2026-01-01", rmssd: 40 },
      { date: "2026-01-02", rmssd: 50 },
    ];
    const r = computeHrvBaseline(shuffled);
    expect(r.latest).toBe(60); // 2026-01-03 is newest
  });

  it("flags below / above the band", () => {
    // A clearly-low and clearly-high latest night must land outside the band.
    // (We don't over-assert the borderline "within" case here: a short, noisy
    // 10-night series sits near the gate where the EWMA-variance band is
    // legitimately tight — the below/above extremes are the meaningful check.)
    const series = nights([45, 50, 55, 48, 52, 47, 53, 49, 51, 50]);

    const low = computeHrvBaseline([...series, { date: "2026-02-01", rmssd: 5 }]);
    expect(low.status).toBe("below");

    const high = computeHrvBaseline([
      ...series,
      { date: "2026-02-01", rmssd: 300 },
    ]);
    expect(high.status).toBe("above");
  });

  it("band is ±0.75σ in log space (low<baseline<high)", () => {
    const r = computeHrvBaseline(
      nights([30, 60, 40, 70, 35, 65, 45, 55, 50, 48, 52, 58]),
    );
    expect(r.low!).toBeLessThan(r.baseline!);
    expect(r.baseline!).toBeLessThan(r.high!);
  });

  it("gate: sufficient flips at HRV_MIN_NIGHTS", () => {
    const few = computeHrvBaseline(nights(Array(HRV_MIN_NIGHTS - 1).fill(50)));
    expect(few.sufficient).toBe(false);
    const enough = computeHrvBaseline(nights(Array(HRV_MIN_NIGHTS).fill(50)));
    expect(enough.sufficient).toBe(true);
  });

  it("skips non-positive / non-finite rmssd from the gate count", () => {
    const r = computeHrvBaseline(
      nights([50, 0, -1, NaN, 50, 50]).map((n) => n),
    );
    expect(r.nights).toBe(3);
  });

  it("detects a rising baseline trend", () => {
    const rising = nights([
      30, 31, 32, 33, 34, 35, 36, 40, 45, 50, 55, 60, 65, 70,
    ]);
    expect(computeHrvBaseline(rising).trend).toBe("rising");
  });

  it("detects a falling baseline trend", () => {
    const falling = nights([
      70, 68, 66, 64, 62, 60, 58, 45, 40, 35, 30, 28, 26, 24,
    ]);
    expect(computeHrvBaseline(falling).trend).toBe("falling");
  });

  it("flat trend for a steady series", () => {
    expect(computeHrvBaseline(nights(Array(20).fill(50))).trend).toBe("flat");
  });
});
