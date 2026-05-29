/**
 * Concrete CoachDataSource over a request's MetricsService. Maps the metric
 * results into the coach's grounded { value, unit, asOf, source } envelopes,
 * returning `unavailable` (never throwing) so the model reports "no data"
 * rather than hallucinating. Identity is the per-request provider — the route
 * builds this; the model never supplies a user id.
 */
import { NotConnectedError } from "@stride/health-core";
import type { MetricsService } from "../metrics/service.ts";
import {
  grounded,
  unavailable,
  type CoachDataSource,
  type ToolResult,
} from "./tools.ts";

const SRC = "fitbit";
const today = () => new Date().toISOString().slice(0, 10);

/** Wrap a producer so provider/compute failures degrade to `unavailable`. */
async function soft<T>(
  fn: () => Promise<ToolResult<T>>,
): Promise<ToolResult<T>> {
  try {
    return await fn();
  } catch (e) {
    if (e instanceof NotConnectedError) return unavailable("fitbit-not-connected");
    return unavailable("compute-error");
  }
}

export function metricsDataSource(m: MetricsService): CoachDataSource {
  return {
    getRecovery: (date = today()) =>
      soft(async () => {
        const r = await m.recovery(date);
        return grounded({
          value: {
            score: { value: r.score, unit: "score", asOf: date, source: SRC },
          },
          unit: "score",
          asOf: date,
          source: r.gatedReason ? "derived" : SRC,
        });
      }),

    getStrain: (date = today()) =>
      soft(async () => {
        const s = await m.strain(date);
        const value = "strain" in s ? s.strain : 0;
        return grounded({ value, unit: "0-21", asOf: date, source: SRC });
      }),

    getSleep: (date = today()) =>
      soft(async () => {
        const s = await m.sleep(date);
        return grounded({
          value: {
            asleepMin: { value: s.tonight?.asleepMin ?? 0, unit: "min", asOf: date, source: SRC },
            inBedMin: { value: s.tonight?.inBedMin ?? 0, unit: "min", asOf: date, source: SRC },
            efficiency: { value: s.tonight?.efficiency ?? 0, unit: "%", asOf: date, source: SRC },
            ...(s.performance != null
              ? { performance: { value: s.performance, unit: "%", asOf: date, source: "derived" as const } }
              : {}),
            needMin: { value: s.need.need, unit: "min", asOf: date, source: "derived" },
            debtMin: { value: s.debt, unit: "min", asOf: date, source: "derived" },
          },
          unit: "sleep",
          asOf: date,
          source: SRC,
        });
      }),

    getHrvTrend: (days = 30) =>
      soft(async () => {
        const h = await m.hrvTrend(today(), days);
        if (h.latest == null || h.baseline == null || h.low == null || h.high == null) {
          return unavailable("no-hrv-data");
        }
        return grounded({
          value: {
            latest: { value: h.latest, unit: "ms", asOf: today(), source: SRC },
            baseline: { value: h.baseline, unit: "ms", asOf: today(), source: "derived" },
            band: { value: { low: h.low, high: h.high }, unit: "ms", asOf: today(), source: "derived" },
            trend: { value: h.trend, unit: "trend", asOf: today(), source: "derived" },
          },
          unit: "ms",
          asOf: today(),
          source: SRC,
        });
      }),

    getStress: (date = today()) =>
      soft(async () => {
        const s = await m.stress(date);
        return grounded({ value: s.index, unit: "0-100 (HR-based estimate)", asOf: date, source: "derived" });
      }),

    getFitnessAge: () =>
      soft(async () => {
        const f = await m.fitnessAge(today());
        if (f.fitnessAge == null) return unavailable(f.reason ?? "no-vo2max");
        return grounded({ value: f.fitnessAge, unit: "years (cardiorespiratory)", asOf: today(), source: "derived" });
      }),

    getDailyActivity: (date = today()) =>
      soft(async () => {
        const a = await m.dailyActivity(date);
        if (!a) return unavailable("no-activity-data");
        return grounded({
          value: {
            steps: { value: a.steps, unit: "steps", asOf: date, source: SRC },
            distanceKm: { value: a.distanceKm, unit: "km", asOf: date, source: SRC },
            activeMinutes: { value: a.activeMinutes, unit: "min", asOf: date, source: SRC },
            caloriesOut: { value: a.caloriesOut, unit: "kcal", asOf: date, source: SRC },
          },
          unit: "activity",
          asOf: date,
          source: SRC,
        });
      }),

    getExercises: (date = today()) =>
      soft(async () => {
        const ex = await m.exercises(date);
        return grounded({
          value: ex.map((e) => ({
            type: e.type,
            startTime: e.startTime.toISOString(),
            durationMin: Math.round(e.durationSec / 60),
            avgHr: e.avgHr,
            calories: e.calories,
            source: e.source,
          })),
          unit: "exercises",
          asOf: date,
          source: SRC,
        });
      }),
  };
}
