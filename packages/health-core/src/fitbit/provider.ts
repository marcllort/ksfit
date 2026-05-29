/**
 * Fitbit Web API implementation of HealthProvider.
 *
 * Reads the authed user's own data ("-" user id) and can log activities.
 * Uses a Personal app (intraday HR available with no special approval).
 * All requests go through `call()`, which refreshes the token on 401 and
 * surfaces 429 rate-limiting as a typed error.
 *
 * NOTE: the legacy Fitbit Web API deprecates Sept 2026 → Google Health API.
 * Everything Fitbit-specific lives in this folder behind HealthProvider.
 */
import {
  type ActivityLogInput,
  type ActivityLogResult,
  type DailyActivity,
  type DayHeartRate,
  type HealthProvider,
  type HeartRatePoint,
  type SleepSummary,
  type WeightReading,
  NotConnectedError,
} from "../types";
import {
  getFreshTokens,
  refreshTokens,
  type FitbitTokens,
  type TokenStore,
} from "./oauth";

const API = "https://api.fitbit.com";

export class FitbitRateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Fitbit rate limit hit; retry after ${retryAfterSec}s`);
    this.name = "FitbitRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

export class FitbitProvider implements HealthProvider {
  readonly name = "Fitbit";

  /** Token persistence is injected (cookie store now, DB store in Phase 2). */
  constructor(private readonly store: TokenStore) {}

  async isConnected(): Promise<boolean> {
    return (await this.store.get()) !== null;
  }

  /** Authenticated request with one refresh-and-retry on 401. */
  private async call<T>(
    path: string,
    init: RequestInit = {},
    retried = false,
  ): Promise<T> {
    const tokens = await getFreshTokens(this.store);
    if (!tokens) throw new NotConnectedError(this.name);
    return this.callWith<T>(tokens, path, init, retried);
  }

  private async callWith<T>(
    tokens: FitbitTokens,
    path: string,
    init: RequestInit,
    retried: boolean,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json",
        "Accept-Language": "en_US", // metric vs imperial controlled separately; en_US default
        ...(init.headers || {}),
      },
      ...({ cache: "no-store" } as RequestInit),
    });

    if (res.status === 401 && !retried) {
      const refreshed = await refreshTokens(this.store, tokens).catch(() => null);
      if (!refreshed) throw new NotConnectedError(this.name);
      return this.callWith<T>(refreshed, path, init, true);
    }
    if (res.status === 429) {
      throw new FitbitRateLimitError(
        Number(res.headers.get("Fitbit-Rate-Limit-Reset") || "3600"),
      );
    }
    if (!res.ok) {
      throw new Error(`Fitbit ${path} → ${res.status} ${await res.text()}`);
    }
    // logActivity returns 201 with a body; some endpoints may 204.
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  async getHeartRateForDay(
    date: string,
    withIntraday: boolean,
  ): Promise<DayHeartRate> {
    // The intraday endpoint also returns the daily summary (resting HR + zones),
    // so one call covers both when intraday is requested.
    const path = withIntraday
      ? `/1/user/-/activities/heart/date/${date}/1d/1min.json`
      : `/1/user/-/activities/heart/date/${date}/1d.json`;
    type Resp = {
      "activities-heart": Array<{
        value?: {
          restingHeartRate?: number;
          heartRateZones?: Array<{ name: string; min: number; max: number; minutes: number }>;
        };
      }>;
      "activities-heart-intraday"?: {
        dataset: Array<{ time: string; value: number }>;
      };
    };
    const j = await this.call<Resp>(path);
    const summary = j["activities-heart"]?.[0]?.value;
    const intraday: HeartRatePoint[] =
      j["activities-heart-intraday"]?.dataset.map((d) => ({
        t: new Date(`${date}T${d.time}Z`).getTime(),
        bpm: d.value,
      })) ?? [];
    return {
      date,
      restingHr: summary?.restingHeartRate ?? null,
      zones:
        summary?.heartRateZones?.map((z) => ({
          name: z.name,
          min: z.min,
          max: z.max,
          minutes: z.minutes,
        })) ?? [],
      intraday,
    };
  }

  async getSleep(date: string): Promise<SleepSummary | null> {
    type Resp = {
      summary?: {
        totalMinutesAsleep?: number;
        totalTimeInBed?: number;
        stages?: { deep: number; light: number; rem: number; wake: number };
      };
      sleep?: Array<{ efficiency?: number }>;
    };
    const j = await this.call<Resp>(`/1.2/user/-/sleep/date/${date}.json`);
    if (!j.summary?.totalMinutesAsleep) return null;
    return {
      date,
      asleepMin: j.summary.totalMinutesAsleep ?? 0,
      inBedMin: j.summary.totalTimeInBed ?? 0,
      efficiency: j.sleep?.[0]?.efficiency ?? 0,
      stages: j.summary.stages,
    };
  }

  async getDailyActivity(date: string): Promise<DailyActivity | null> {
    type Resp = {
      summary?: {
        steps?: number;
        caloriesOut?: number;
        distances?: Array<{ activity: string; distance: number }>;
        fairlyActiveMinutes?: number;
        veryActiveMinutes?: number;
        floors?: number;
      };
    };
    const j = await this.call<Resp>(`/1/user/-/activities/date/${date}.json`);
    const s = j.summary;
    if (!s) return null;
    const totalKm =
      s.distances?.find((d) => d.activity === "total")?.distance ?? 0;
    return {
      date,
      steps: s.steps ?? 0,
      distanceKm: totalKm,
      caloriesOut: s.caloriesOut ?? 0,
      activeMinutes: (s.fairlyActiveMinutes ?? 0) + (s.veryActiveMinutes ?? 0),
      floors: s.floors,
    };
  }

  async getWeightLog(fromDate: string, toDate: string): Promise<WeightReading[]> {
    type Resp = {
      weight?: Array<{
        date: string;
        time?: string;
        weight: number;
        bmi?: number;
        fat?: number;
      }>;
    };
    const j = await this.call<Resp>(
      `/1/user/-/body/log/weight/date/${fromDate}/${toDate}.json`,
    );
    return (j.weight ?? []).map((w) => ({
      t: new Date(`${w.date}T${w.time ?? "00:00:00"}Z`).getTime(),
      weightKg: w.weight,
      bmi: w.bmi,
      fatPct: w.fat,
    }));
  }

  async logActivity(input: ActivityLogInput): Promise<ActivityLogResult> {
    // Walking = 90013. Fitbit wants startTime as HH:mm (NO seconds — including
    // seconds returns wrong data), date as yyyy-MM-dd, duration in ms.
    const date = input.start.toISOString().slice(0, 10);
    const startTime = input.start.toISOString().slice(11, 16); // HH:mm (UTC)
    const params = new URLSearchParams({
      activityId: "90013",
      startTime,
      durationMillis: String(Math.round(input.durationSec * 1000)),
      date,
      distance: String((input.distanceM / 1000).toFixed(3)),
      distanceUnit: "Kilometer",
    });
    if (input.kcal && input.kcal > 0) {
      params.set("manualCalories", String(Math.round(input.kcal)));
    }
    type Resp = { activityLog?: { logId?: number } };
    const j = await this.call<Resp>(
      `/1/user/-/activities.json?${params.toString()}`,
      { method: "POST" },
    );
    return {
      externalId: j.activityLog?.logId ? String(j.activityLog.logId) : null,
      alreadyLogged: false,
    };
  }
}
// The provider is constructed per request with an injected TokenStore — see
// the host's fitbit store factory (no module-level singleton).
