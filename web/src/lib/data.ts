/**
 * Domain transforms layered on top of the raw KS Fit responses.
 *
 * KS Fit returns numbers as strings; distance in metres; time in seconds; and
 * `consume` is kilocalories × 1000 (the cloud preserves three decimals). All
 * conversion happens here so UI code is unit-free. See CONSUME_SCALE below.
 */
import type { SportRecord, WeightEntry } from "./ksfit";

/**
 * Divisor that turns the raw `consume` field into kilocalories.
 *
 * The cloud stores kcal × 1000 (three decimals of precision). This was
 * verified empirically: per-second point-list cumulative-kcal values match
 * `record.consume / 1000` exactly for the same session. Older docs/comments
 * claimed × 10 — that is incorrect; this constant is the single source of
 * truth, mirrored in demo.ts.
 */
export const CONSUME_SCALE = 1000;

export interface NormalizedSession {
  runId: string;
  detailId: string;
  startTime: Date;
  endTime: Date;
  durationSec: number;
  distanceM: number;
  steps: number;
  kcal: number;
  heartAvg: number;
  paceSecPerKm: number; // seconds per km, 0 if undefined
  avgSpeedKmh: number;
  model: string;
  deviceId: string;
  courseName: string;
  isAppleWatch: boolean;
  raw: SportRecord;
}

const toNum = (v: unknown, dflt = 0): number => {
  if (v === null || v === undefined || v === "") return dflt;
  const n = typeof v === "number" ? v : Number(v);
  return Number.isFinite(n) ? n : dflt;
};

export function normalizeSession(r: SportRecord): NormalizedSession {
  // KS Fit start_time is a wall-clock string in the device's reported tz.
  // We treat it as UTC-naive for sorting and let formatting handle locale.
  const startTime = new Date(r.start_time.replace(" ", "T") + "Z");
  const durationSec = toNum(r.time);
  const distanceM = toNum(r.distance);
  const kcal = toNum(r.consume) / CONSUME_SCALE;
  const steps = toNum(r.steps);
  const heartAvg = toNum(r.heart);
  const avgSpeedKmh =
    durationSec > 0 ? (distanceM / 1000) / (durationSec / 3600) : 0;
  const paceSecPerKm =
    distanceM > 0 ? Math.round(durationSec / (distanceM / 1000)) : 0;
  return {
    runId: r.run_id,
    detailId: r.detailid,
    startTime,
    endTime: new Date(startTime.getTime() + durationSec * 1000),
    durationSec,
    distanceM,
    steps,
    kcal,
    heartAvg,
    paceSecPerKm,
    avgSpeedKmh,
    model: r.model,
    deviceId: r.did,
    courseName: r.course_name || "",
    isAppleWatch: toNum(r.is_iwatch) === 1,
    raw: r,
  };
}

/** Records arrive newest-first OR oldest-first depending on the endpoint;
 *  normalize them and re-sort newest-first. */
export function normalizeAll(records: SportRecord[]): NormalizedSession[] {
  return records
    .map(normalizeSession)
    .sort((a, b) => b.startTime.getTime() - a.startTime.getTime());
}

/** YYYY-MM-DD key from a session's local-naive timestamp. */
export function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

export interface DayBucket {
  date: string;
  sessions: NormalizedSession[];
  durationSec: number;
  distanceM: number;
  steps: number;
  kcal: number;
}

export function groupByDay(sessions: NormalizedSession[]): Map<string, DayBucket> {
  const map = new Map<string, DayBucket>();
  for (const s of sessions) {
    const k = dayKey(s.startTime);
    let b = map.get(k);
    if (!b) {
      b = { date: k, sessions: [], durationSec: 0, distanceM: 0, steps: 0, kcal: 0 };
      map.set(k, b);
    }
    b.sessions.push(s);
    b.durationSec += s.durationSec;
    b.distanceM += s.distanceM;
    b.steps += s.steps;
    b.kcal += s.kcal;
  }
  return map;
}

export interface RangeStats {
  durationSec: number;
  distanceM: number;
  steps: number;
  kcal: number;
  count: number;
  activeDays: number;
}

export function sumStats(
  sessions: NormalizedSession[],
  fromInclusive?: Date,
  toExclusive?: Date,
): RangeStats {
  const inRange = sessions.filter(
    (s) =>
      (!fromInclusive || s.startTime >= fromInclusive) &&
      (!toExclusive || s.startTime < toExclusive),
  );
  const days = new Set(inRange.map((s) => dayKey(s.startTime)));
  return {
    count: inRange.length,
    durationSec: inRange.reduce((a, s) => a + s.durationSec, 0),
    distanceM: inRange.reduce((a, s) => a + s.distanceM, 0),
    steps: inRange.reduce((a, s) => a + s.steps, 0),
    kcal: inRange.reduce((a, s) => a + s.kcal, 0),
    activeDays: days.size,
  };
}

/** Empty bucket used when a day has no sessions but a downstream view still
 *  wants a stable shape (KPIs of zero rather than undefined branches). */
export function emptyBucket(date: string): DayBucket {
  return {
    date,
    sessions: [],
    durationSec: 0,
    distanceM: 0,
    steps: 0,
    kcal: 0,
  };
}

/** Convenience: get the bucket for `date` or a zeroed placeholder. */
export function bucketFor(
  buckets: Map<string, DayBucket>,
  date: string,
): DayBucket {
  return buckets.get(date) ?? emptyBucket(date);
}

/** Mean steps across the last `n` days that actually had any steps logged.
 *  Excludes zero-step days so a long stretch of inactivity doesn't dilute the
 *  "what's typical for me when I move" benchmark used by the ring underlay. */
export function avgActiveDailySteps(
  sessions: NormalizedSession[],
  n: number,
  today: Date = new Date(),
): number {
  const days = lastNDays(sessions, n, today);
  const active = days.filter((d) => d.steps > 0);
  if (active.length === 0) return 0;
  return Math.round(
    active.reduce((a, d) => a + d.steps, 0) / active.length,
  );
}

/** Mean steps on the same weekday as `date`, looking back `weeks` weeks
 *  (default 8). Includes zero-step days so the average is an honest
 *  "what does my typical Sunday look like" — rest days included.
 *  The reference day itself is excluded. */
export function sameWeekdayAvg(
  buckets: Map<string, DayBucket>,
  date: string,
  weeks = 8,
): number {
  const d = new Date(date + "T00:00:00Z");
  let total = 0;
  let n = 0;
  for (let i = 1; i <= weeks; i++) {
    const k = dayKey(new Date(d.getTime() - i * 7 * 86_400_000));
    const b = buckets.get(k);
    total += b?.steps ?? 0;
    n += 1;
  }
  return n > 0 ? Math.round(total / n) : 0;
}

/** Count of consecutive days, ending today, that hit `goal` steps.
 *  Today is allowed to be "in progress" — if today hasn't met goal yet we
 *  don't break the streak; we count back from yesterday instead. */
export function currentStreak(
  buckets: Map<string, DayBucket>,
  goal: number,
  today: Date = new Date(),
): number {
  if (goal <= 0) return 0;
  const todayUtc = new Date(
    Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), today.getUTCDate()),
  );
  let cursor = todayUtc;
  let streak = 0;
  // Special-case today: don't penalise a streak just because the day isn't
  // over yet. If today met goal, include it; otherwise start from yesterday.
  const todayBucket = buckets.get(dayKey(cursor));
  if ((todayBucket?.steps ?? 0) >= goal) {
    streak += 1;
  }
  cursor = new Date(cursor.getTime() - 86_400_000);
  while (true) {
    const b = buckets.get(dayKey(cursor));
    if ((b?.steps ?? 0) >= goal) {
      streak += 1;
      cursor = new Date(cursor.getTime() - 86_400_000);
    } else {
      break;
    }
  }
  return streak;
}

/** Returns an array of N day buckets ending today (inclusive), oldest first.
 *  Empty days are present with zeroed stats so heatmaps stay rectangular. */
export function lastNDays(
  sessions: NormalizedSession[],
  n: number,
  todayUtc: Date = new Date(),
): DayBucket[] {
  const today = new Date(
    Date.UTC(
      todayUtc.getUTCFullYear(),
      todayUtc.getUTCMonth(),
      todayUtc.getUTCDate(),
    ),
  );
  const buckets = groupByDay(sessions);
  const out: DayBucket[] = [];
  for (let i = n - 1; i >= 0; i--) {
    const d = new Date(today.getTime() - i * 86_400_000);
    const k = dayKey(d);
    out.push(
      buckets.get(k) ?? {
        date: k,
        sessions: [],
        durationSec: 0,
        distanceM: 0,
        steps: 0,
        kcal: 0,
      },
    );
  }
  return out;
}

/* ----------------- formatters ------------------------------------------- */

/**
 * Timezone-stable date/time formatting for session & weight timestamps.
 *
 * Session `start_time` is a wall-clock string that we parse as UTC-naive (see
 * normalizeSession — we append "Z"). The whole app buckets those instants in
 * UTC (dayKey, groupByDay, the day panel). Therefore every place that renders
 * one of these Dates MUST also format in UTC, or a session can display under a
 * different day/time than the bucket it was grouped into. Always format these
 * timestamps via these helpers (never a bare toLocale*), so the convention
 * stays in exactly one place.
 */
export function fmtDateTime(
  d: Date,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return d.toLocaleString(locale, { ...options, timeZone: "UTC" });
}

export function fmtDate(
  d: Date,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return d.toLocaleDateString(locale, { ...options, timeZone: "UTC" });
}

export function fmtTime(
  d: Date,
  options: Intl.DateTimeFormatOptions,
  locale?: string,
): string {
  return d.toLocaleTimeString(locale, { ...options, timeZone: "UTC" });
}

export function fmtKm(m: number, digits = 2): string {
  return (m / 1000).toFixed(digits);
}

export function fmtDuration(sec: number): string {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  const s = sec % 60;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

export function fmtDurationCompact(sec: number): string {
  if (!sec) return "0m";
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h > 0) return `${h}h${m ? ` ${m}m` : ""}`;
  return `${m}m`;
}

export function fmtPace(secPerKm: number): string {
  if (!secPerKm) return "—";
  const m = Math.floor(secPerKm / 60);
  const s = Math.round(secPerKm % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function fmtKcal(k: number): string {
  return Math.round(k).toLocaleString();
}

export function fmtSteps(s: number): string {
  return s.toLocaleString();
}

export function fmtNumber(n: number): string {
  return n.toLocaleString();
}

/* ----------------- weight log ------------------------------------------- */

export interface NormalizedWeight {
  id: string;
  weight: number;
  bmi: number;
  at: Date;
  fat: number;
  /** Body-water percentage (0 when the scale didn't report it). */
  waterRate: number;
  /** Basal metabolic rate, kcal/day. */
  bmr: number;
  /** Visceral-fat index. */
  visceralFat: number;
  /** Muscle mass (kg). */
  muscleMass: number;
  bodyAge: number;
}

export function normalizeWeights(entries: WeightEntry[]): NormalizedWeight[] {
  // KS Fit uses -1 (and sometimes 0) as a "not measured" sentinel for the
  // body-composition fields a basic scale can't read — treat those as absent.
  const nonNeg = (v: unknown): number => Math.max(0, toNum(v));
  return entries
    .map((e) => ({
      id: e.id,
      weight: toNum(e.weight),
      bmi: nonNeg(e.BMI),
      at: new Date(e.add_time.replace(" ", "T") + "Z"),
      fat: nonNeg(e.fat),
      waterRate: nonNeg(e.waterRate),
      bmr: nonNeg(e.bmr),
      visceralFat: nonNeg(e.visceralFat),
      muscleMass: nonNeg(e.muscleVolume),
      bodyAge: nonNeg(e.bodyAge),
    }))
    .sort((a, b) => a.at.getTime() - b.at.getTime());
}

/* ----------------- point list (per-second telemetry) ------------------- */

export interface SessionPoint {
  t: number; // elapsed seconds since session start
  speedKmh: number;
  distanceM: number;
  steps: number;
  kcal: number;
  cadence: number;
}

/** The KS Fit `record.getRecordPoint` response wraps a JSON-string in a JSON
 *  string. The inner `pointsData` is an array of 15–17 element rows whose
 *  schema drifted across firmware versions but the first 6 are stable:
 *
 *    [0] speed × 10 (km/h)   [3] cumulative distance (m)
 *    [1] elapsed seconds     [4] cumulative kcal
 *    [2] cumulative steps    [5] cadence (steps/min)
 */
export function parsePointList(raw: unknown): SessionPoint[] {
  if (!raw) return [];
  let outer: unknown = raw;
  if (typeof outer === "object" && outer && "point" in outer) {
    outer = (outer as { point: unknown }).point;
  }
  if (typeof outer === "object" && outer && "point_list" in outer) {
    outer = (outer as { point_list: unknown }).point_list;
  }
  if (typeof outer !== "string") return [];
  let inner: { pointsData?: unknown[] };
  try {
    inner = JSON.parse(outer);
  } catch {
    return [];
  }
  const pd = inner.pointsData;
  if (!Array.isArray(pd)) return [];
  return pd
    .map((row): SessionPoint | null => {
      if (!Array.isArray(row) || row.length < 6) return null;
      return {
        speedKmh: toNum(row[0]) / 10,
        t: toNum(row[1]),
        steps: toNum(row[2]),
        distanceM: toNum(row[3]),
        kcal: toNum(row[4]),
        cadence: toNum(row[5]),
      };
    })
    .filter((p): p is SessionPoint => p !== null)
    .sort((a, b) => a.t - b.t);
}
