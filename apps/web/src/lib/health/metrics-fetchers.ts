/**
 * Web-side WHOOP-metric accessors — a thin client over the backend's
 * /v1/metrics/* + /v1/exercises endpoints.
 *
 * The web app does NOT compute health metrics in-process; the backend
 * (apps/backend) runs the deterministic compute*() functions and owns the
 * provider/token custody. These accessors just GET the result over HTTP
 * (forwarding the session cookie) and fail soft to null/[] so pages can render
 * the not-connected Empty state. Return types are derived from the same
 * @stride/health-core compute signatures the backend uses, so the shapes match.
 */
import type {
  DailyActivity,
  Exercise,
  computeRecovery,
  computeStrain,
  computeStress,
  computeHrvBaseline,
  computeFitnessAge,
  computeSleepNeed,
  sleepRecommendations,
  SleepSummary,
} from "@stride/health-core";
import { backendGet } from "../backend";

export type RecoveryMetric = ReturnType<typeof computeRecovery>;
export type StrainMetric =
  | ReturnType<typeof computeStrain>
  | { strain: number; calibrating: true; reason: "insufficient-data" };
export type StressMetric =
  | ReturnType<typeof computeStress>
  | {
      index: number;
      bucket: "low";
      calibrating: true;
      label: "Stress (HR-based estimate)";
    };
export type HrvMetric = ReturnType<typeof computeHrvBaseline>;
export type FitnessAgeMetric = ReturnType<typeof computeFitnessAge>;

export interface SleepMetric {
  tonight: SleepSummary | null;
  baselineNeed: number;
  need: ReturnType<typeof computeSleepNeed>;
  debt: number;
  performance: number | null;
  recommendations: ReturnType<typeof sleepRecommendations>;
}

const today = () => new Date().toISOString().slice(0, 10);

export async function metricRecovery(
  date: string = today(),
): Promise<RecoveryMetric | null> {
  return (await backendGet<RecoveryMetric>(`/v1/metrics/recovery?date=${date}`)).data;
}

export async function metricStrain(
  date: string = today(),
): Promise<StrainMetric | null> {
  return (await backendGet<StrainMetric>(`/v1/metrics/strain?date=${date}`)).data;
}

export async function metricSleep(
  date: string = today(),
): Promise<SleepMetric | null> {
  return (await backendGet<SleepMetric>(`/v1/metrics/sleep?date=${date}`)).data;
}

export async function metricStress(
  date: string = today(),
): Promise<StressMetric | null> {
  return (await backendGet<StressMetric>(`/v1/metrics/stress?date=${date}`)).data;
}

export async function metricHrvTrend(
  date: string = today(),
  days = 30,
): Promise<HrvMetric | null> {
  return (await backendGet<HrvMetric>(`/v1/metrics/hrv?date=${date}&days=${days}`)).data;
}

export async function metricFitnessAge(
  date: string = today(),
): Promise<FitnessAgeMetric | null> {
  return (await backendGet<FitnessAgeMetric>(`/v1/metrics/fitness-age?date=${date}`)).data;
}

export async function metricDailyActivity(
  date: string = today(),
): Promise<DailyActivity | null> {
  return (await backendGet<DailyActivity>(`/v1/metrics/daily-activity?date=${date}`)).data;
}

/** The wire shape from /v1/exercises (epoch-ms time, km distance, autoDetected). */
interface ExerciseDTO {
  id: string;
  type: string;
  startTime: number;
  durationSec: number;
  distanceKm?: number;
  calories?: number;
  avgHr?: number;
  hrZones?: Exercise["hrZones"];
  autoDetected: boolean;
}

/** Map the wire DTO back to the domain Exercise shape the pages consume. */
export async function metricExercises(date: string = today()): Promise<Exercise[]> {
  const r = await backendGet<{ items: ExerciseDTO[] }>(`/v1/exercises?date=${date}`);
  if (!r.data?.items) return [];
  return r.data.items.map((e) => ({
    id: e.id,
    type: e.type,
    startTime: new Date(e.startTime),
    durationSec: e.durationSec,
    distanceM: e.distanceKm != null ? e.distanceKm * 1000 : undefined,
    calories: e.calories,
    avgHr: e.avgHr,
    hrZones: e.hrZones,
    source: e.autoDetected ? "auto" : "manual",
  }));
}
