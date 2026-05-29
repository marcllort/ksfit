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
}

export class NotConnectedError extends Error {
  constructor(provider: string) {
    super(`${provider} is not connected`);
    this.name = "NotConnectedError";
  }
}
