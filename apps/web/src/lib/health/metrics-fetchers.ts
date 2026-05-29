/**
 * Web-side WHOOP-style metrics, mirroring apps/backend/src/lib/metrics/service.ts.
 *
 * The backend wires a request-scoped HealthProvider into the pure compute*()
 * functions from @stride/health-core. Here we do the same, but bind the
 * provider to the Next.js cookie store via `await fitbitProvider()`.
 *
 * Every accessor is cached (in the same in-process TTL cache as the other
 * fetchers) and fails soft: it returns `null` when Fitbit isn't connected or a
 * call throws, so pages can render the not-connected Empty state without
 * try/catch. The history-window logic is copied verbatim from the backend
 * service so the two sides stay in lockstep.
 */
import { withCache } from "../cache";
import { fitbitProvider } from "./fitbit/web-store";
import { fitbitConnected } from "./fetchers";
import type {
  HeartRatePoint,
  HrvReading,
  UserProfile,
} from "@stride/health-core";
import {
  computeHrvBaseline,
  computeRecovery,
  computeStrain,
  computeTrimp,
  computeStress,
  computeFitnessAge,
  computeBaselineNeed,
  computeSleepNeed,
  computeSleepPerformance,
  computeSleepDebt,
  sleepRecommendations,
  hrMaxFromAge,
  exerciseWindows,
} from "@stride/health-core";

const DAY = 86_400_000;

/** TTLs (ms) — derived metrics are pricier, so a touch longer than raw fetchers. */
const TTL = {
  recovery: 15 * 60_000,
  strain: 15 * 60_000,
  sleep: 30 * 60_000,
  stress: 15 * 60_000,
  hrv: 30 * 60_000,
  fitnessAge: 60 * 60_000,
  daily: 10 * 60_000,
  exercises: 15 * 60_000,
} as const;

/** Inclusive list of YYYY-MM-DD keys ending at `date`, `n` days back. */
function priorDays(date: string, n: number): string[] {
  const end = new Date(`${date}T00:00:00Z`).getTime();
  const out: string[] = [];
  for (let i = n - 1; i >= 0; i--) out.push(isoDay(end - i * DAY));
  return out;
}
function isoDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Bounded concurrency map (avoid hammering the rate-limited upstream). */
async function mapLimit<T, R>(
  items: readonly T[],
  limit: number,
  fn: (item: T) => Promise<R>,
): Promise<R[]> {
  const out: R[] = new Array(items.length);
  let i = 0;
  async function worker() {
    while (i < items.length) {
      const idx = i++;
      out[idx] = await fn(items[idx]!);
    }
  }
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, worker),
  );
  return out;
}

async function hrvHistory(date: string, nights = 30): Promise<HrvReading[]> {
  const provider = await fitbitProvider();
  const days = priorDays(date, nights);
  const readings = await mapLimit(days, 4, (d) => provider.getHrv(d));
  return readings.filter((r): r is HrvReading => r != null);
}

async function restingHrHistory(date: string, nights = 30): Promise<number[]> {
  const provider = await fitbitProvider();
  const days = priorDays(date, nights);
  const hr = await mapLimit(days, 4, (d) =>
    provider.getHeartRateForDay(d, false),
  );
  return hr.map((h) => h?.restingHr ?? 0).filter((v) => v > 0);
}

async function trimpHistory(
  date: string,
  restingHr: number,
  hrMax: number,
  sex: UserProfile["sex"],
): Promise<number[]> {
  const provider = await fitbitProvider();
  const days = priorDays(date, 90).slice(0, -1); // exclude today
  const hrs = await mapLimit(days, 3, (d) =>
    provider.getHeartRateForDay(d, true),
  );
  return hrs
    .map((h) =>
      h?.intraday?.length
        ? computeTrimp({ intraday: h.intraday, restingHr, hrMax, sex }).trimp
        : 0,
    )
    .filter((v) => v > 0);
}

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
  tonight: Awaited<ReturnType<Awaited<ReturnType<typeof fitbitProvider>>["getSleep"]>>;
  baselineNeed: number;
  need: ReturnType<typeof computeSleepNeed>;
  debt: number;
  performance: number | null;
  recommendations: ReturnType<typeof sleepRecommendations>;
}

/** Day Strain 0–21. Needs intraday HR + resting HR + age-derived HRmax. */
async function computeStrainForDay(date: string): Promise<StrainMetric> {
  const provider = await fitbitProvider();
  const [day, profile] = await Promise.all([
    provider.getHeartRateForDay(date, true),
    provider.getProfile(),
  ]);
  const intraday: HeartRatePoint[] = day?.intraday ?? [];
  const restingHr = day?.restingHr ?? 0;
  const hrMax = profile?.age ? hrMaxFromAge(profile.age) : 0;
  if (!intraday.length || !restingHr || !hrMax) {
    return { strain: 0, calibrating: true, reason: "insufficient-data" };
  }
  const trimpHist = await trimpHistory(date, restingHr, hrMax, profile?.sex);
  return computeStrain({
    intraday,
    restingHr,
    hrMax,
    sex: profile?.sex,
    trimpHistory: trimpHist,
  });
}

async function computeSleepForDay(date: string): Promise<SleepMetric> {
  const provider = await fitbitProvider();
  const [tonight, priorNights] = await Promise.all([
    provider.getSleep(date),
    mapLimit(priorDays(date, 14), 4, (d) => provider.getSleep(d)),
  ]);
  const asleepHistory = priorNights
    .filter((s): s is NonNullable<typeof s> => s != null)
    .map((s) => s.asleepMin);
  const baselineNeed = computeBaselineNeed(asleepHistory);
  const debt = computeSleepDebt(
    priorNights
      .filter((s): s is NonNullable<typeof s> => s != null)
      .map((s) => ({ asleepMin: s.asleepMin, needMin: baselineNeed })),
  );
  const priorStrain = await computeStrainForDay(
    isoDay(new Date(`${date}T00:00:00Z`).getTime() - DAY),
  )
    .then((s) => ("strain" in s ? s.strain : null))
    .catch(() => null);
  const need = computeSleepNeed({ baselineNeed, currentDebt: debt, priorStrain });
  const performance = tonight
    ? computeSleepPerformance(tonight.asleepMin, need.need)
    : null;
  return {
    tonight,
    baselineNeed,
    need,
    debt,
    performance,
    recommendations: sleepRecommendations({
      performance: performance ?? 0,
      needMin: need.need,
      asleepMin: tonight?.asleepMin ?? 0,
      debtMin: debt,
      efficiency: tonight?.efficiency,
    }),
  };
}

async function sleepPerformanceFor(date: string): Promise<number | null> {
  try {
    return (await computeSleepForDay(date)).performance;
  } catch {
    return null;
  }
}

async function computeRecoveryForDay(date: string): Promise<RecoveryMetric> {
  const provider = await fitbitProvider();
  const [hrvHist, rhrHist, today, br, sleepP] = await Promise.all([
    hrvHistory(date),
    restingHrHistory(date),
    provider.getHeartRateForDay(date, false),
    provider.getBreathingRate(date),
    sleepPerformanceFor(date),
  ]);
  const hrvTonight = hrvHist.find((r) => r.date === date)?.rmssd ?? null;
  return computeRecovery({
    hrvTonight,
    hrvHistory: hrvHist,
    restingHrTonight: today?.restingHr ?? null,
    restingHrHistory: rhrHist,
    breathingTonight: br?.breathsPerMin ?? null,
    sleepPerformance: sleepP,
  });
}

async function computeStressForDay(date: string): Promise<StressMetric> {
  const provider = await fitbitProvider();
  const [day, profile] = await Promise.all([
    provider.getHeartRateForDay(date, true),
    provider.getProfile(),
  ]);
  const intraday = day?.intraday ?? [];
  const restingHr = day?.restingHr ?? 0;
  const hrMax = profile?.age ? hrMaxFromAge(profile.age) : 0;
  if (!intraday.length || !restingHr || !hrMax) {
    return {
      index: 0,
      bucket: "low",
      calibrating: true,
      label: "Stress (HR-based estimate)",
    };
  }
  const exercises = await provider.getExercises(date);
  return computeStress({
    intraday,
    restingHr,
    hrMax,
    exclude: exerciseWindows(exercises),
  });
}

async function computeFitnessAgeForDay(date: string): Promise<FitnessAgeMetric> {
  const provider = await fitbitProvider();
  const [cardio, profile] = await Promise.all([
    provider.getCardioScore(date),
    provider.getProfile(),
  ]);
  return computeFitnessAge({
    vo2max: cardio?.vo2max ?? null,
    profile: {
      age: profile?.age,
      sex: profile?.sex,
      waistCm: profile?.waistCm,
    },
  });
}

// ---------------------------------------------------------------------------
// Cached, fail-soft public accessors.
// ---------------------------------------------------------------------------

export async function metricRecovery(
  date: string,
): Promise<RecoveryMetric | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:recovery:${date}`, TTL.recovery, () =>
      computeRecoveryForDay(date),
    );
  } catch {
    return null;
  }
}

export async function metricStrain(date: string): Promise<StrainMetric | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:strain:${date}`, TTL.strain, () =>
      computeStrainForDay(date),
    );
  } catch {
    return null;
  }
}

export async function metricSleep(date: string): Promise<SleepMetric | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:sleep:${date}`, TTL.sleep, () =>
      computeSleepForDay(date),
    );
  } catch {
    return null;
  }
}

export async function metricStress(date: string): Promise<StressMetric | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:stress:${date}`, TTL.stress, () =>
      computeStressForDay(date),
    );
  } catch {
    return null;
  }
}

export async function metricHrvTrend(
  date: string,
  days = 30,
): Promise<HrvMetric | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:hrv:${date}:${days}`, TTL.hrv, async () =>
      computeHrvBaseline(await hrvHistory(date, days)),
    );
  } catch {
    return null;
  }
}

export async function metricFitnessAge(
  date: string,
): Promise<FitnessAgeMetric | null> {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:fitness-age:${date}`, TTL.fitnessAge, () =>
      computeFitnessAgeForDay(date),
    );
  } catch {
    return null;
  }
}

export async function metricDailyActivity(date: string) {
  if (!(await fitbitConnected())) return null;
  try {
    return await withCache(`metric:daily:${date}`, TTL.daily, async () =>
      (await fitbitProvider()).getDailyActivity(date),
    );
  } catch {
    return null;
  }
}

export async function metricExercises(date: string) {
  if (!(await fitbitConnected())) return [];
  try {
    return await withCache(`metric:exercises:${date}`, TTL.exercises, async () =>
      (await fitbitProvider()).getExercises(date),
    );
  } catch {
    return [];
  }
}
