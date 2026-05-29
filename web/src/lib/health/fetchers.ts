/**
 * Cached, fail-soft accessors for the active health provider (Fitbit today).
 *
 * Every function returns a "feature off" shape (null / empty) when the provider
 * isn't connected or a call fails, so pages can render Fitbit sections
 * conditionally without try/catch everywhere. Responses are cached in the same
 * in-process TTL cache as KS Fit data, keyed under "fitbit:".
 */
import { withCache } from "../cache";
import { fitbitProvider } from "./fitbit/provider";
import { fitbitConfigured } from "./fitbit/tokens";
import type {
  DailyActivity,
  DayHeartRate,
  SleepSummary,
  WeightReading,
} from "./types";

const TTL = {
  hr: 10 * 60_000,
  daily: 10 * 60_000,
  sleep: 30 * 60_000,
  weight: 30 * 60_000,
  connected: 30_000,
} as const;

export async function fitbitConnected(): Promise<boolean> {
  if (!fitbitConfigured) return false;
  try {
    return await withCache("fitbit:connected", TTL.connected, () =>
      fitbitProvider().isConnected(),
    );
  } catch {
    return false;
  }
}

export async function fitbitHeartRateForDay(
  date: string,
  withIntraday: boolean,
): Promise<DayHeartRate | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(
      `fitbit:hr:${date}:${withIntraday ? "intra" : "sum"}`,
      TTL.hr,
      () => fitbitProvider().getHeartRateForDay(date, withIntraday),
    );
  } catch {
    return null;
  }
}

export async function fitbitSleep(date: string): Promise<SleepSummary | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`fitbit:sleep:${date}`, TTL.sleep, () =>
      fitbitProvider().getSleep(date),
    );
  } catch {
    return null;
  }
}

export async function fitbitDailyActivity(
  date: string,
): Promise<DailyActivity | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`fitbit:daily:${date}`, TTL.daily, () =>
      fitbitProvider().getDailyActivity(date),
    );
  } catch {
    return null;
  }
}

export async function fitbitWeight(
  fromDate: string,
  toDate: string,
): Promise<WeightReading[]> {
  if (!(await fitbitConnected())) return [];
  try {
    return await withCache(
      `fitbit:weight:${fromDate}:${toDate}`,
      TTL.weight,
      () => fitbitProvider().getWeightLog(fromDate, toDate),
    );
  } catch {
    return [];
  }
}
