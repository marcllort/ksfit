/**
 * metrics repo — two surfaces:
 *
 *  - dailyScores: the derived WHOOP-style snapshot rows (recovery / strain /
 *    sleep / HRV / etc.), one per (user, date). The nightly derivation job upserts
 *    these; the API and coach read them. JSON columns (recoveryComponents,
 *    sleepStages, sleepNeedBreakdown) are (de)serialized here.
 *  - cachedMetrics: the durable, day-grained mirror of the hot TTL cache for raw
 *    provider reads (daily_activity / sleep / hr_day / weight / hrv / ...). Stores
 *    one normalized provider payload per (user, provider, kind, date).
 *
 * Numbers are computed upstream in packages/health-core; this repo only persists.
 */

import { and, eq, gte, lte } from "drizzle-orm";

import type { StrideDb } from "../client";
import { cachedMetrics, dailyScores } from "../schema";

/* ----------------------------- daily_scores ------------------------------- */

export interface DailyScore {
  userId: string;
  date: string; // YYYY-MM-DD
  recovery: number | null;
  recoveryComponents:
    | { hrvZ: number; rhrZ: number; brZ: number; sleepZ: number }
    | null;
  strain: number | null;
  trimp: number | null;
  hrvRmssd: number | null;
  hrvLnEwma: number | null;
  hrvBandLow: number | null;
  hrvBandHigh: number | null;
  restingHr: number | null;
  breathingRate: number | null;
  spo2: number | null;
  skinTempDev: number | null;
  sleepAsleepMin: number | null;
  sleepInBedMin: number | null;
  sleepEfficiency: number | null;
  sleepStages:
    | { deep: number; light: number; rem: number; wake: number }
    | null;
  sleepNeedMin: number | null;
  sleepNeedBreakdown: Record<string, number> | null;
  sleepPerformance: number | null;
  sleepDebtMin: number | null;
  caloriesOut: number | null;
  vo2max: number | null;
  fitnessAge: number | null;
  stressEstimate: number | null;
  computedAt: number;
}

/** Fields the derivation job may write; date+userId identify the row. */
export type DailyScoreUpsert = Omit<DailyScore, "computedAt"> & {
  computedAt?: number;
};

function parseJson<T>(v: string | null): T | null {
  return v == null ? null : (JSON.parse(v) as T);
}
function stringifyJson(v: unknown): string | null {
  return v == null ? null : JSON.stringify(v);
}

/* ----------------------------- cached_metrics ----------------------------- */

export type CachedMetricKind =
  | "daily_activity"
  | "sleep"
  | "hr_day"
  | "weight"
  | "hrv"
  | "breathing"
  | "spo2"
  | "skin_temp"
  | "cardio_score";

export function metricsRepo(db: StrideDb) {
  return {
    /* -- derived daily snapshots -- */

    /** Upsert one derived snapshot row for (user, date). */
    upsertDaily(input: DailyScoreUpsert): void {
      const row = {
        userId: input.userId,
        date: input.date,
        recovery: input.recovery,
        recoveryComponents: stringifyJson(input.recoveryComponents),
        strain: input.strain,
        trimp: input.trimp,
        hrvRmssd: input.hrvRmssd,
        hrvLnEwma: input.hrvLnEwma,
        hrvBandLow: input.hrvBandLow,
        hrvBandHigh: input.hrvBandHigh,
        restingHr: input.restingHr,
        breathingRate: input.breathingRate,
        spo2: input.spo2,
        skinTempDev: input.skinTempDev,
        sleepAsleepMin: input.sleepAsleepMin,
        sleepInBedMin: input.sleepInBedMin,
        sleepEfficiency: input.sleepEfficiency,
        sleepStages: stringifyJson(input.sleepStages),
        sleepNeedMin: input.sleepNeedMin,
        sleepNeedBreakdown: stringifyJson(input.sleepNeedBreakdown),
        sleepPerformance: input.sleepPerformance,
        sleepDebtMin: input.sleepDebtMin,
        caloriesOut: input.caloriesOut,
        vo2max: input.vo2max,
        fitnessAge: input.fitnessAge,
        stressEstimate: input.stressEstimate,
        computedAt: input.computedAt ?? Date.now(),
      };
      db.insert(dailyScores)
        .values(row)
        .onConflictDoUpdate({
          target: [dailyScores.userId, dailyScores.date],
          set: row,
        })
        .run();
    },

    /** Read one snapshot, JSON columns parsed. */
    getDaily(userId: string, date: string): DailyScore | null {
      const row = db
        .select()
        .from(dailyScores)
        .where(and(eq(dailyScores.userId, userId), eq(dailyScores.date, date)))
        .get();
      return row ? hydrateScore(row) : null;
    },

    /** Read an inclusive date range (ascending), for trend/EWMA windows. */
    getDailyRange(
      userId: string,
      fromDate: string,
      toDate: string,
    ): DailyScore[] {
      const rows = db
        .select()
        .from(dailyScores)
        .where(
          and(
            eq(dailyScores.userId, userId),
            gte(dailyScores.date, fromDate),
            lte(dailyScores.date, toDate),
          ),
        )
        .all();
      return rows
        .map(hydrateScore)
        .sort((a, b) => a.date.localeCompare(b.date));
    },

    /* -- durable day-grained provider cache -- */

    /** Upsert a normalized provider payload for (user, provider, kind, date). */
    putCached(
      userId: string,
      provider: string,
      kind: CachedMetricKind,
      metricDate: string,
      payload: unknown,
      fetchedAt = Date.now(),
    ): void {
      const row = {
        userId,
        provider,
        kind,
        metricDate,
        payload: JSON.stringify(payload),
        fetchedAt,
      };
      db.insert(cachedMetrics)
        .values(row)
        .onConflictDoUpdate({
          target: [
            cachedMetrics.userId,
            cachedMetrics.provider,
            cachedMetrics.kind,
            cachedMetrics.metricDate,
          ],
          set: { payload: row.payload, fetchedAt },
        })
        .run();
    },

    /**
     * Read a cached payload. Returns null on miss or when older than maxAgeMs.
     * @param maxAgeMs TTL; omit to ignore staleness.
     */
    getCached<T>(
      userId: string,
      provider: string,
      kind: CachedMetricKind,
      metricDate: string,
      maxAgeMs?: number,
      now = Date.now(),
    ): T | null {
      const row = db
        .select()
        .from(cachedMetrics)
        .where(
          and(
            eq(cachedMetrics.userId, userId),
            eq(cachedMetrics.provider, provider),
            eq(cachedMetrics.kind, kind),
            eq(cachedMetrics.metricDate, metricDate),
          ),
        )
        .get();
      if (!row) return null;
      if (maxAgeMs != null && now - row.fetchedAt > maxAgeMs) return null;
      return JSON.parse(row.payload) as T;
    },
  };
}

function hydrateScore(row: typeof dailyScores.$inferSelect): DailyScore {
  return {
    userId: row.userId,
    date: row.date,
    recovery: row.recovery ?? null,
    recoveryComponents: parseJson(row.recoveryComponents),
    strain: row.strain ?? null,
    trimp: row.trimp ?? null,
    hrvRmssd: row.hrvRmssd ?? null,
    hrvLnEwma: row.hrvLnEwma ?? null,
    hrvBandLow: row.hrvBandLow ?? null,
    hrvBandHigh: row.hrvBandHigh ?? null,
    restingHr: row.restingHr ?? null,
    breathingRate: row.breathingRate ?? null,
    spo2: row.spo2 ?? null,
    skinTempDev: row.skinTempDev ?? null,
    sleepAsleepMin: row.sleepAsleepMin ?? null,
    sleepInBedMin: row.sleepInBedMin ?? null,
    sleepEfficiency: row.sleepEfficiency ?? null,
    sleepStages: parseJson(row.sleepStages),
    sleepNeedMin: row.sleepNeedMin ?? null,
    sleepNeedBreakdown: parseJson(row.sleepNeedBreakdown),
    sleepPerformance: row.sleepPerformance ?? null,
    sleepDebtMin: row.sleepDebtMin ?? null,
    caloriesOut: row.caloriesOut ?? null,
    vo2max: row.vo2max ?? null,
    fitnessAge: row.fitnessAge ?? null,
    stressEstimate: row.stressEstimate ?? null,
    computedAt: row.computedAt,
  };
}

export type MetricsRepo = ReturnType<typeof metricsRepo>;
