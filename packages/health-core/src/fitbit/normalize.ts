/**
 * Pure parsing helpers that turn raw Fitbit Web API JSON into the shared
 * domain types in ../types. No network, no I/O — deterministic and unit-testable.
 *
 * Each Fitbit endpoint wraps its payload in a single-element array keyed by the
 * resource name (e.g. `{ "hrv": [{ ... }] }`). These helpers take that array
 * (or the relevant slice) and return the normalized type, or null/[] when the
 * field is absent — the fail-soft contract many of these device-dependent
 * signals require.
 */
import type {
  BreathingReading,
  CardioScore,
  Exercise,
  HeartRateZone,
  HrvReading,
  SkinTempReading,
  Spo2Reading,
  UserProfile,
} from "../types";

// ── Raw Fitbit response shapes (only the fields we read) ────────────────────

export interface RawHrvResp {
  hrv?: Array<{
    dateTime?: string;
    value?: { dailyRmssd?: number; deepRmssd?: number; coverage?: number };
  }>;
}

export interface RawBreathingResp {
  br?: Array<{
    dateTime?: string;
    value?: {
      breathingRate?: number;
      fullSleepSummary?: { breathingRate?: number };
    };
  }>;
}

export interface RawSpo2Resp {
  // Single-date endpoint returns an object; range would return an array.
  dateTime?: string;
  value?: { avg?: number; min?: number; max?: number };
}

export interface RawSkinTempResp {
  tempSkin?: Array<{
    dateTime?: string;
    value?: { nightlyRelative?: number };
  }>;
}

export interface RawCardioScoreResp {
  cardioScore?: Array<{
    dateTime?: string;
    // vo2Max is either "41" or a range string like "39-43".
    value?: { vo2Max?: string };
  }>;
}

export interface RawActivityLogEntry {
  logId?: number;
  activityName?: string;
  activityTypeId?: number;
  startTime?: string; // ISO 8601 with offset
  duration?: number; // milliseconds
  distance?: number; // in the unit named by distanceUnit, usually km
  distanceUnit?: string;
  calories?: number;
  averageHeartRate?: number;
  logType?: string; // "auto_detected" | "manual" | "tracker" | "mobile_run" | ...
  heartRateZones?: Array<{
    name?: string;
    min?: number;
    max?: number;
    minutes?: number;
  }>;
}

export interface RawActivityListResp {
  activities?: RawActivityLogEntry[];
}

export interface RawProfileResp {
  user?: {
    age?: number;
    gender?: string; // "MALE" | "FEMALE" | "NA"
    height?: number; // cm when Accept-Language requests metric
    weight?: number; // kg
  };
}

// ── Normalizers ─────────────────────────────────────────────────────────────

export function normalizeHrv(j: RawHrvResp, date: string): HrvReading | null {
  const entry = j.hrv?.[0]?.value;
  const rmssd = entry?.dailyRmssd ?? entry?.deepRmssd;
  if (typeof rmssd !== "number") return null;
  return {
    date,
    rmssd,
    ...(typeof entry?.coverage === "number" ? { coverage: entry.coverage } : {}),
  };
}

export function normalizeBreathing(
  j: RawBreathingResp,
  date: string,
): BreathingReading | null {
  const v = j.br?.[0]?.value;
  const bpm = v?.breathingRate ?? v?.fullSleepSummary?.breathingRate;
  if (typeof bpm !== "number") return null;
  return { date, breathsPerMin: bpm };
}

export function normalizeSpo2(j: RawSpo2Resp, date: string): Spo2Reading | null {
  const avg = j.value?.avg;
  if (typeof avg !== "number") return null;
  return {
    date,
    avgPct: avg,
    ...(typeof j.value?.min === "number" ? { minPct: j.value.min } : {}),
  };
}

export function normalizeSkinTemp(
  j: RawSkinTempResp,
  date: string,
): SkinTempReading | null {
  const rel = j.tempSkin?.[0]?.value?.nightlyRelative;
  if (typeof rel !== "number") return null;
  return { date, relativeC: rel };
}

export function normalizeCardioScore(
  j: RawCardioScoreResp,
  date: string,
): CardioScore | null {
  const raw = j.cardioScore?.[0]?.value?.vo2Max;
  const parsed = parseVo2Max(raw);
  if (!parsed) return null;
  return { date, ...parsed };
}

/** "41" → {vo2max:41}; "39-43" → {vo2max:41, range:{low:39,high:43}}. */
export function parseVo2Max(
  raw: string | undefined,
): { vo2max: number; range?: { low: number; high: number } } | null {
  if (!raw) return null;
  const trimmed = raw.trim();
  const dash = trimmed.indexOf("-");
  if (dash > 0) {
    const low = Number(trimmed.slice(0, dash));
    const high = Number(trimmed.slice(dash + 1));
    if (!Number.isFinite(low) || !Number.isFinite(high)) return null;
    return { vo2max: (low + high) / 2, range: { low, high } };
  }
  const v = Number(trimmed);
  return Number.isFinite(v) ? { vo2max: v } : null;
}

/** Fitbit logType → our coarse source flag. Only SmartTrack is "auto". */
export function exerciseSource(logType: string | undefined): "auto" | "manual" {
  return logType === "auto_detected" ? "auto" : "manual";
}

export function normalizeExercises(j: RawActivityListResp): Exercise[] {
  const out: Exercise[] = [];
  for (const a of j.activities ?? []) {
    if (a.logId == null || !a.startTime) continue;
    const zones: HeartRateZone[] | undefined = a.heartRateZones?.map((z) => ({
      name: z.name ?? "",
      min: z.min ?? 0,
      max: z.max ?? 0,
      minutes: z.minutes ?? 0,
    }));
    out.push({
      id: String(a.logId),
      startTime: new Date(a.startTime),
      durationSec: Math.round((a.duration ?? 0) / 1000),
      type: a.activityName ?? "Workout",
      ...(typeof a.distance === "number"
        ? { distanceM: toMeters(a.distance, a.distanceUnit) }
        : {}),
      ...(typeof a.calories === "number" ? { calories: a.calories } : {}),
      ...(typeof a.averageHeartRate === "number"
        ? { avgHr: a.averageHeartRate }
        : {}),
      ...(zones && zones.length ? { hrZones: zones } : {}),
      source: exerciseSource(a.logType),
    });
  }
  return out;
}

function toMeters(distance: number, unit: string | undefined): number {
  switch ((unit ?? "Kilometer").toLowerCase()) {
    case "meter":
    case "meters":
      return distance;
    case "mile":
    case "miles":
      return distance * 1609.344;
    case "kilometer":
    case "kilometers":
    default:
      return distance * 1000;
  }
}

export function normalizeProfile(j: RawProfileResp): UserProfile | null {
  const u = j.user;
  if (!u) return null;
  const profile: UserProfile = {};
  if (typeof u.age === "number") profile.age = u.age;
  const sex = mapSex(u.gender);
  if (sex) profile.sex = sex;
  if (typeof u.height === "number") profile.heightCm = u.height;
  if (typeof u.weight === "number") profile.weightKg = u.weight;
  // waistCm is not exposed by the Fitbit profile endpoint; left undefined.
  return profile;
}

function mapSex(gender: string | undefined): UserProfile["sex"] | undefined {
  switch (gender) {
    case "MALE":
      return "male";
    case "FEMALE":
      return "female";
    case "NA":
      return "unspecified";
    default:
      return undefined;
  }
}
