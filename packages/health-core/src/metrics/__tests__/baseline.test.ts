import { describe, it, expect } from "vitest";
import {
  spanToLambda,
  clamp,
  standardNormalCdf,
  ewma,
  zScore,
  percentile,
} from "../baseline";

describe("spanToLambda", () => {
  it("converts span to λ = 2/(N+1)", () => {
    expect(spanToLambda(30)).toBeCloseTo(2 / 31, 12);
    expect(spanToLambda(1)).toBeCloseTo(1, 12);
  });
  it("rejects non-positive spans", () => {
    expect(() => spanToLambda(0)).toThrow(RangeError);
    expect(() => spanToLambda(-5)).toThrow();
  });
});

describe("clamp", () => {
  it("bounds a value", () => {
    expect(clamp(5, 0, 3)).toBe(3);
    expect(clamp(-1, 0, 3)).toBe(0);
    expect(clamp(2, 0, 3)).toBe(2);
  });
});

describe("standardNormalCdf", () => {
  it("is 0.5 at 0", () => {
    expect(standardNormalCdf(0)).toBeCloseTo(0.5, 6);
  });
  it("matches known quantiles", () => {
    expect(standardNormalCdf(1)).toBeCloseTo(0.8413, 3);
    expect(standardNormalCdf(-1)).toBeCloseTo(0.1587, 3);
    expect(standardNormalCdf(1.96)).toBeCloseTo(0.975, 3);
  });
  it("is symmetric: Φ(x)+Φ(−x)=1", () => {
    for (const x of [0.3, 1.1, 2.4, 3]) {
      expect(standardNormalCdf(x) + standardNormalCdf(-x)).toBeCloseTo(1, 6);
    }
  });
});

describe("ewma", () => {
  it("seeds on the first finite sample with zero variance", () => {
    const s = ewma([10], { span: 30 });
    expect(s.mean).toBe(10);
    expect(s.variance).toBe(0);
    expect(s.count).toBe(1);
  });
  it("converges toward a constant series", () => {
    const s = ewma(Array(50).fill(42), { span: 10 });
    expect(s.mean).toBeCloseTo(42, 9);
    expect(s.sd).toBeCloseTo(0, 9);
    expect(s.count).toBe(50);
  });
  it("weights recent samples more (last value pulls the mean up)", () => {
    const flat = ewma(Array(20).fill(50), { span: 10 }).mean;
    const bumped = ewma([...Array(19).fill(50), 80], { span: 10 }).mean;
    expect(bumped).toBeGreaterThan(flat);
    expect(bumped).toBeLessThan(80);
  });
  it("skips non-finite samples", () => {
    const a = ewma([10, NaN, 20, Infinity, 30], { span: 5 });
    const b = ewma([10, 20, 30], { span: 5 });
    expect(a.mean).toBeCloseTo(b.mean, 12);
    expect(a.count).toBe(3);
  });
  it("ln option runs in log space and skips non-positive", () => {
    const s = ewma([Math.E, Math.E, Math.E], { span: 10, ln: true });
    expect(s.mean).toBeCloseTo(1, 9); // ln(e) = 1
    const skipped = ewma([Math.E, 0, -3, Math.E], { span: 10, ln: true });
    expect(skipped.count).toBe(2);
  });
  it("tracks dispersion via variance", () => {
    const s = ewma([10, 20, 10, 20, 10, 20], { span: 5 });
    expect(s.sd).toBeGreaterThan(0);
  });
});

describe("zScore", () => {
  const state = ewma(Array(30).fill(50), { span: 30 }); // sd ~ 0
  it("returns 0 at-baseline when sd is ~0 (no divide-by-zero)", () => {
    expect(zScore(80, state)).toBe(0);
  });
  it("computes and clamps to [-3,3]", () => {
    const s = ewma([10, 12, 8, 11, 9, 13, 7, 12, 8, 11], { span: 10 });
    const z = zScore(100, s);
    expect(z).toBe(3);
    expect(zScore(-100, s)).toBe(-3);
  });
  it("returns 0 for non-finite latest", () => {
    const s = ewma([10, 12, 8, 11], { span: 5 });
    expect(zScore(NaN, s)).toBe(0);
  });
  it("ln z-scores in log space", () => {
    const s = ewma([20, 25, 22, 30, 18, 27, 21], { span: 7, ln: true });
    expect(zScore(0, s, { ln: true })).toBe(0); // non-positive guarded
    expect(Number.isFinite(zScore(40, s, { ln: true }))).toBe(true);
  });
});

describe("percentile", () => {
  it("interpolates linearly", () => {
    expect(percentile([0, 10], 0.5)).toBeCloseTo(5, 9);
    expect(percentile([1, 2, 3, 4], 0)).toBe(1);
    expect(percentile([1, 2, 3, 4], 1)).toBe(4);
  });
  it("p95 of 1..100 ≈ 95.05", () => {
    const xs = Array.from({ length: 100 }, (_, i) => i + 1);
    expect(percentile(xs, 0.95)).toBeCloseTo(95.05, 2);
  });
  it("handles single + empty", () => {
    expect(percentile([7], 0.95)).toBe(7);
    expect(Number.isNaN(percentile([], 0.5))).toBe(true);
  });
});
