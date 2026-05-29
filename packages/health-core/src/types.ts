/**
 * Provider-agnostic health-data types.
 *
 * The dashboard talks to an external health service (heart rate, sleep, etc.)
 * exclusively through the HealthProvider interface below. Today the only
 * implementation is Fitbit (see fitbit/provider.ts). Fitbit's legacy Web API
 * is slated for deprecation in Sept 2026 in favour of the Google Health API
 * (health.googleapis.com/v4) — keeping every call behind this interface means
 * adding a GoogleHealthProvider later is a localized change, not a rewrite.
 */

export interface HeartRatePoint {
  /** Unix epoch ms (UTC). */
  t: number;
  bpm: number;
}

export interface HeartRateZone {
  name: string; // "Out of Range" | "Fat Burn" | "Cardio" | "Peak"
  min: number;
  max: number;
  minutes: number;
}

export interface DayHeartRate {
  date: string; // YYYY-MM-DD
  restingHr: number | null;
  zones: HeartRateZone[];
  /** Intraday series for the day, empty if not fetched/available. */
  intraday: HeartRatePoint[];
}

export interface SleepSummary {
  date: string; // YYYY-MM-DD (the wake date)
  /** Total time asleep, minutes. */
  asleepMin: number;
  /** Time in bed, minutes. */
  inBedMin: number;
  efficiency: number; // 0-100
  stages?: { deep: number; light: number; rem: number; wake: number };
}

export interface DailyActivity {
  date: string; // YYYY-MM-DD
  steps: number;
  distanceKm: number;
  caloriesOut: number;
  activeMinutes: number;
  floors?: number;
}

export interface WeightReading {
  /** Unix epoch ms (UTC). */
  t: number;
  weightKg: number;
  bmi?: number;
  fatPct?: number;
}

/**
 * Daily HRV summary (overnight RMSSD). Fitbit reports a single nightly value
 * computed during deep sleep; `coverage` (0-1) reflects how much of the night
 * had usable data, when the provider exposes it.
 */
export interface HrvReading {
  date: string; // YYYY-MM-DD (the wake date)
  /** Root mean square of successive differences, milliseconds. */
  rmssd: number;
  /** Fraction of the night with usable data, 0-1, if provided. */
  coverage?: number;
}

/** Overnight breathing (respiratory) rate. */
export interface BreathingReading {
  date: string; // YYYY-MM-DD
  breathsPerMin: number;
}

/** Overnight blood-oxygen saturation. */
export interface Spo2Reading {
  date: string; // YYYY-MM-DD
  avgPct: number;
  minPct?: number;
}

/**
 * Overnight skin temperature, reported by Fitbit as a deviation from the
 * personal baseline (degrees Celsius), not an absolute temperature.
 */
export interface SkinTempReading {
  date: string; // YYYY-MM-DD
  /** Deviation from baseline, °C (can be negative). */
  relativeC: number;
}

/**
 * Cardio-fitness score (VO2max estimate). Fitbit may report either a single
 * value or a range when it lacks a recent GPS run to pin it down.
 */
export interface CardioScore {
  date: string; // YYYY-MM-DD
  /** VO2max, ml/kg/min. When the provider gives a range, the midpoint. */
  vo2max: number;
  range?: { low: number; high: number };
}

/**
 * A detected or manually-logged workout with HR summary. `source: 'auto'`
 * marks Fitbit SmartTrack auto-detection vs a manually-logged session.
 */
export interface Exercise {
  /** Stable provider id for the logged activity. */
  id: string;
  /** Start instant (UTC). */
  startTime: Date;
  durationSec: number;
  /** Activity type/name, e.g. "Walk", "Run", "Weights". */
  type: string;
  distanceM?: number;
  /** kcal. */
  calories?: number;
  avgHr?: number;
  /** Time-in-zone breakdown when the provider supplies it. */
  hrZones?: HeartRateZone[];
  source: "auto" | "manual";
}

/**
 * Static user attributes needed to compute honest metrics (HRmax, fitness age,
 * BMR, norm-table lookups). Every field optional — captured progressively.
 */
export interface UserProfile {
  /** Years; provider may report it directly or via DOB. */
  age?: number;
  sex?: "male" | "female" | "unspecified";
  heightCm?: number;
  weightKg?: number;
  waistCm?: number;
}

/** A walk/treadmill session to push to the external service. */
export interface ActivityLogInput {
  /** Start instant (UTC). */
  start: Date;
  durationSec: number;
  distanceM: number;
  /** kcal (real kilocalories, already scaled). */
  kcal?: number;
  /** Stable id of the source session, for dedupe bookkeeping. */
  sourceId: string;
}

export interface ActivityLogResult {
  /** The provider's id for the created log, if it returns one. */
  externalId: string | null;
  alreadyLogged: boolean;
}

/**
 * The capability surface the dashboard depends on. A provider may throw
 * NotConnectedError when no valid token is available; callers treat that as
 * "feature off" rather than a hard error.
 */
export interface HealthProvider {
  readonly name: string;
  /** True when a usable token exists (cheap check, no network). */
  isConnected(): Promise<boolean>;

  getHeartRateForDay(date: string, withIntraday: boolean): Promise<DayHeartRate>;
  getSleep(date: string): Promise<SleepSummary | null>;
  getDailyActivity(date: string): Promise<DailyActivity | null>;
  getWeightLog(fromDate: string, toDate: string): Promise<WeightReading[]>;

  logActivity(input: ActivityLogInput): Promise<ActivityLogResult>;

  /**
   * New signals that gate WHOOP-style metrics. All fail soft: return null/[]
   * when the field is absent (many are device-dependent) rather than throwing.
   */
  getHrv(date: string): Promise<HrvReading | null>;
  getBreathingRate(date: string): Promise<BreathingReading | null>;
  getSpo2(date: string): Promise<Spo2Reading | null>;
  getSkinTemp(date: string): Promise<SkinTempReading | null>;
  getCardioScore(date: string): Promise<CardioScore | null>;
  /** Detected + manual workouts logged on the given day. */
  getExercises(date: string): Promise<Exercise[]>;
  getProfile(): Promise<UserProfile | null>;
}

export class NotConnectedError extends Error {
  constructor(provider: string) {
    super(`${provider} is not connected`);
    this.name = "NotConnectedError";
  }
}
