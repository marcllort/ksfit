/**
 * MetricsService — the bridge between a HealthProvider's raw signals and the
 * deterministic WHOOP-style computations in @stride/health-core/metrics.
 *
 * It fetches the history windows each metric needs (HRV/RHR/breathing nights,
 * intraday HR, sleep, daily TRIMP) and feeds them to the pure compute*()
 * functions. Provider calls are bounded and fail-soft: a missing signal yields
 * a gated/empty result, never a throw (except auth/rate-limit, which bubble).
 *
 * Heavy reads are memoized per (provider-instance, date) for the life of one
 * request via the injected cache; the nightly cron will later persist the
 * derived snapshots to @stride/db so the dashboards read from there.
 */
import type {
  HealthProvider,
  HeartRatePoint,
  HrvReading,
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
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
  return out;
}

export class MetricsService {
  constructor(private readonly provider: HealthProvider) {}

  private async hrvHistory(date: string, nights = 30): Promise<HrvReading[]> {
    const days = priorDays(date, nights);
    const readings = await mapLimit(days, 4, (d) => this.provider.getHrv(d));
    return readings.filter((r): r is HrvReading => r != null);
  }

  private async restingHrHistory(date: string, nights = 30): Promise<number[]> {
    const days = priorDays(date, nights);
    const hr = await mapLimit(days, 4, (d) =>
      this.provider.getHeartRateForDay(d, false),
    );
    return hr.map((h) => h?.restingHr ?? 0).filter((v) => v > 0);
  }

  async recovery(date: string) {
    const [hrvHist, rhrHist, today, br, sleepP] = await Promise.all([
      this.hrvHistory(date),
      this.restingHrHistory(date),
      this.provider.getHeartRateForDay(date, false),
      this.provider.getBreathingRate(date),
      this.sleepPerformance(date),
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

  /** Day Strain 0–21. Needs intraday HR + resting HR + age-derived HRmax. */
  async strain(date: string) {
    const [day, profile] = await Promise.all([
      this.provider.getHeartRateForDay(date, true),
      this.provider.getProfile(),
    ]);
    const intraday: HeartRatePoint[] = day?.intraday ?? [];
    const restingHr = day?.restingHr ?? 0;
    const hrMax = profile?.age ? hrMaxFromAge(profile.age) : 0;
    if (!intraday.length || !restingHr || !hrMax) {
      return { strain: 0, calibrating: true, reason: "insufficient-data" as const };
    }
    const trimpHistory = await this.trimpHistory(date, restingHr, hrMax, profile?.sex);
    return computeStrain({ intraday, restingHr, hrMax, sex: profile?.sex, trimpHistory });
  }

  private async trimpHistory(
    date: string,
    restingHr: number,
    hrMax: number,
    sex: HealthProvider extends never ? never : Parameters<typeof computeTrimp>[0]["sex"],
  ): Promise<number[]> {
    const days = priorDays(date, 90).slice(0, -1); // exclude today
    const hrs = await mapLimit(days, 3, (d) => this.provider.getHeartRateForDay(d, true));
    return hrs
      .map((h) =>
        h?.intraday?.length
          ? computeTrimp({ intraday: h.intraday, restingHr, hrMax, sex }).trimp
          : 0,
      )
      .filter((v) => v > 0);
  }

  async sleep(date: string) {
    const [tonight, priorNights] = await Promise.all([
      this.provider.getSleep(date),
      mapLimit(priorDays(date, 14), 4, (d) => this.provider.getSleep(d)),
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
    const priorStrain = await this.strain(isoDay(new Date(`${date}T00:00:00Z`).getTime() - DAY))
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

  private async sleepPerformance(date: string): Promise<number | null> {
    try {
      return (await this.sleep(date)).performance;
    } catch {
      return null;
    }
  }

  async stress(date: string) {
    const [day, profile] = await Promise.all([
      this.provider.getHeartRateForDay(date, true),
      this.provider.getProfile(),
    ]);
    const intraday = day?.intraday ?? [];
    const restingHr = day?.restingHr ?? 0;
    const hrMax = profile?.age ? hrMaxFromAge(profile.age) : 0;
    if (!intraday.length || !restingHr || !hrMax) {
      return { index: 0, bucket: "low" as const, calibrating: true, label: "Stress (HR-based estimate)" };
    }
    const exercises = await this.provider.getExercises(date);
    return computeStress({
      intraday,
      restingHr,
      hrMax,
      exclude: exerciseWindows(exercises),
    });
  }

  async hrvTrend(date: string, days = 30) {
    return computeHrvBaseline(await this.hrvHistory(date, days));
  }

  async fitnessAge(date: string) {
    const [cardio, profile] = await Promise.all([
      this.provider.getCardioScore(date),
      this.provider.getProfile(),
    ]);
    return computeFitnessAge({
      vo2max: cardio?.vo2max ?? null,
      profile: { age: profile?.age, sex: profile?.sex, waistCm: profile?.waistCm },
    });
  }

  async dailyActivity(date: string) {
    return this.provider.getDailyActivity(date);
  }

  async exercises(date: string) {
    return this.provider.getExercises(date);
  }
}
