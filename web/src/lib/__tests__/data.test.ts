import { describe, it, expect } from "vitest";
import {
  CONSUME_SCALE,
  normalizeSession,
  normalizeWeights,
  parsePointList,
  dayKey,
  groupByDay,
  currentStreak,
  fmtDateTime,
  fmtDate,
  fmtTime,
  fmtPace,
  fmtDuration,
} from "../data";
import type { SportRecord, WeightEntry } from "../ksfit";

/** Minimal SportRecord factory — only the fields normalizeSession reads. */
function record(over: Partial<SportRecord> = {}): SportRecord {
  return {
    detailid: "1",
    did: "DEV-1",
    run_id: "run-1",
    distance: "3000", // 3 km
    time: "1800", // 30 min
    consume: "180000", // → 180 kcal at CONSUME_SCALE=1000
    steps: "4000",
    model: "WalkingPad P2",
    start_time: "2026-01-15 07:30:00",
    add_time: "2026-01-15 07:30:00",
    heart: "110",
    slope_max: "0",
    power: "0",
    resistance: "0",
    product_id: "1",
    course_name: "",
    course_id: null,
    course_type: "0",
    device_type: null,
    is_iwatch: 0,
    ...over,
  } as SportRecord;
}

describe("normalizeSession", () => {
  it("converts units: metres, seconds, and consume / CONSUME_SCALE", () => {
    const s = normalizeSession(record());
    expect(s.distanceM).toBe(3000);
    expect(s.durationSec).toBe(1800);
    // 180000 / 1000 = 180 kcal — guards against the historical ×10 confusion.
    expect(s.kcal).toBe(180000 / CONSUME_SCALE);
    expect(s.kcal).toBe(180);
  });

  it("computes avg speed and pace from distance + duration", () => {
    const s = normalizeSession(record());
    // 3 km in 0.5 h = 6 km/h.
    expect(s.avgSpeedKmh).toBeCloseTo(6, 5);
    // 1800 s / 3 km = 600 s/km.
    expect(s.paceSecPerKm).toBe(600);
  });

  it("treats start_time as UTC-naive and derives endTime from duration", () => {
    const s = normalizeSession(record());
    expect(s.startTime.toISOString()).toBe("2026-01-15T07:30:00.000Z");
    expect(s.endTime.toISOString()).toBe("2026-01-15T08:00:00.000Z");
  });

  it("guards against zero duration / distance (no NaN, no divide-by-zero)", () => {
    const s = normalizeSession(record({ time: "0", distance: "0" }));
    expect(s.avgSpeedKmh).toBe(0);
    expect(s.paceSecPerKm).toBe(0);
  });

  it("flags Apple Watch sessions via is_iwatch", () => {
    expect(normalizeSession(record({ is_iwatch: 1 })).isAppleWatch).toBe(true);
    expect(normalizeSession(record({ is_iwatch: 0 })).isAppleWatch).toBe(false);
  });
});

describe("dayKey / groupByDay", () => {
  it("buckets by UTC calendar day", () => {
    expect(dayKey(new Date("2026-01-15T07:30:00Z"))).toBe("2026-01-15");
    // 23:30 UTC stays on the 15th (the bug would shift it in a +tz render).
    expect(dayKey(new Date("2026-01-15T23:30:00Z"))).toBe("2026-01-15");
  });

  it("groups multiple sessions on the same day and sums totals", () => {
    const sessions = [
      normalizeSession(record({ run_id: "a", start_time: "2026-01-15 07:00:00" })),
      normalizeSession(record({ run_id: "b", start_time: "2026-01-15 18:00:00" })),
      normalizeSession(record({ run_id: "c", start_time: "2026-01-16 07:00:00" })),
    ];
    const buckets = groupByDay(sessions);
    expect(buckets.get("2026-01-15")?.sessions).toHaveLength(2);
    expect(buckets.get("2026-01-15")?.distanceM).toBe(6000);
    expect(buckets.get("2026-01-16")?.sessions).toHaveLength(1);
  });
});

describe("currentStreak", () => {
  const goal = 3000;
  const day = (d: string, steps: number) =>
    normalizeSession(record({ run_id: d, start_time: `${d} 07:00:00`, steps: String(steps) }));

  it("counts consecutive goal-meeting days ending today", () => {
    const today = new Date("2026-01-15T12:00:00Z");
    const sessions = [
      day("2026-01-13", 5000),
      day("2026-01-14", 5000),
      day("2026-01-15", 5000),
    ];
    expect(currentStreak(groupByDay(sessions), goal, today)).toBe(3);
  });

  it("does not break the streak when today is still in progress (below goal)", () => {
    const today = new Date("2026-01-15T09:00:00Z");
    const sessions = [
      day("2026-01-13", 5000),
      day("2026-01-14", 5000),
      day("2026-01-15", 100), // today, not yet at goal
    ];
    // Counts back from yesterday: 13th + 14th = 2.
    expect(currentStreak(groupByDay(sessions), goal, today)).toBe(2);
  });

  it("returns 0 when the goal is non-positive", () => {
    const today = new Date("2026-01-15T12:00:00Z");
    expect(currentStreak(groupByDay([day("2026-01-15", 9000)]), 0, today)).toBe(0);
  });
});

describe("parsePointList", () => {
  const wrap = (rows: number[][]) => ({
    point: { point_list: JSON.stringify({ pointsData: rows }) },
  });

  it("decodes the stable 6-column row schema (double-wrapped JSON)", () => {
    const pts = parsePointList(wrap([[55, 0, 0, 0, 0, 80], [60, 5, 12, 8, 500, 88]]));
    expect(pts).toHaveLength(2);
    expect(pts[0]).toMatchObject({ speedKmh: 5.5, t: 0, cadence: 80 });
    expect(pts[1]).toMatchObject({ speedKmh: 6, t: 5, steps: 12, distanceM: 8, cadence: 88 });
  });

  it("sorts by elapsed time", () => {
    const pts = parsePointList(wrap([[60, 10, 0, 0, 0, 0], [55, 0, 0, 0, 0, 0]]));
    expect(pts.map((p) => p.t)).toEqual([0, 10]);
  });

  it("skips malformed / too-short rows", () => {
    const pts = parsePointList(wrap([[55, 0, 0, 0, 0, 80], [1, 2]] as number[][]));
    expect(pts).toHaveLength(1);
  });

  it("returns [] for null, non-JSON, or missing pointsData", () => {
    expect(parsePointList(null)).toEqual([]);
    expect(parsePointList({ point: { point_list: "not json" } })).toEqual([]);
    expect(parsePointList({ point: { point_list: JSON.stringify({}) } })).toEqual([]);
  });
});

describe("normalizeWeights", () => {
  const entry = (over: Partial<WeightEntry>): WeightEntry =>
    ({
      id: "1",
      weight: "78.5",
      BMI: "24.1",
      add_time: "2026-01-10 08:00:00",
      fat: "20.0",
      waterRate: "55",
      bmr: "1600",
      visceralFat: "6",
      muscleVolume: "55",
      bodyAge: "30",
      ...over,
    }) as WeightEntry;

  it("parses numbers and sorts oldest-first", () => {
    const out = normalizeWeights([
      entry({ id: "b", add_time: "2026-01-12 08:00:00", weight: "78.0" }),
      entry({ id: "a", add_time: "2026-01-10 08:00:00", weight: "78.5" }),
    ]);
    expect(out.map((w) => w.id)).toEqual(["a", "b"]);
    expect(out[0].weight).toBe(78.5);
    expect(out[0].at.toISOString()).toBe("2026-01-10T08:00:00.000Z");
  });

  it("carries body-composition fields", () => {
    const [w] = normalizeWeights([entry({ waterRate: "55", bmr: "1600", visceralFat: "6", muscleVolume: "55" })]);
    expect(w).toMatchObject({ waterRate: 55, bmr: 1600, visceralFat: 6, muscleMass: 55 });
  });

  it("treats KS Fit -1 sentinels as absent (clamped to 0)", () => {
    const [w] = normalizeWeights([
      entry({ fat: "-1", waterRate: "-1", bmr: "-1", visceralFat: "-1", muscleVolume: "-1", bodyAge: "-1" }),
    ]);
    expect(w.fat).toBe(0);
    expect(w.waterRate).toBe(0);
    expect(w.bmr).toBe(0);
    expect(w.visceralFat).toBe(0);
    expect(w.muscleMass).toBe(0);
    expect(w.bodyAge).toBe(0);
  });
});

describe("UTC formatters", () => {
  // A 23:30 UTC instant must render on the same calendar day it's bucketed in,
  // regardless of the machine's timezone (this is the bug the helpers fix).
  const d = new Date("2026-01-15T23:30:00Z");

  it("fmtDate renders the UTC calendar day", () => {
    expect(fmtDate(d, { year: "numeric", month: "2-digit", day: "2-digit" }, "en-US")).toBe(
      "01/15/2026",
    );
  });

  it("fmtTime renders the UTC time", () => {
    expect(fmtTime(d, { hour: "2-digit", minute: "2-digit", hour12: false }, "en-GB")).toBe(
      "23:30",
    );
  });

  it("fmtDateTime renders UTC date + time together", () => {
    const out = fmtDateTime(d, { dateStyle: "short", timeStyle: "short", hour12: false }, "en-GB");
    expect(out).toContain("23:30");
  });
});

describe("misc formatters", () => {
  it("fmtPace formats seconds-per-km as m:ss", () => {
    expect(fmtPace(600)).toBe("10:00");
    expect(fmtPace(0)).toBe("—");
  });

  it("fmtDuration is human-readable", () => {
    expect(fmtDuration(0)).toBe("0m");
    expect(fmtDuration(90)).toBe("1m 30s");
    expect(fmtDuration(3661)).toBe("1h 01m");
  });
});
