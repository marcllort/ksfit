/**
 * Google Health API implementation of HealthProvider.
 *
 * The Google Health API (https://developers.google.com/health) is the successor
 * to the legacy Fitbit Web API and surfaces the SAME underlying Fitbit / Pixel
 * Watch data. Reads the authed user's own data via the "users/me" resource.
 *
 * Unlike Fitbit's 100+ resource-specific endpoints, Google Health exposes ONE
 * generic read shape — list data points of a given data type over a time range:
 *
 *   GET https://health.googleapis.com/v4/users/me/dataTypes/{dataType}/dataPoints
 *        ?filter=<AIP-160 time expression>&pageSize=<n>
 *
 * Verified at:
 *   - service endpoint + v4 + resources:
 *     https://developers.google.com/health/reference/rest
 *   - list method (filter syntax, pageSize defaults):
 *     https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints/list
 *   - DataPoint shape (name + dataSource + one typed union member):
 *     https://developers.google.com/health/reference/rest/v4/users.dataTypes.dataPoints
 *   - data type identifiers (kebab-case in the path, snake_case in filters):
 *     https://developers.google.com/health/data-types
 *   - user profile:
 *     https://developers.google.com/health/reference/rest/v4/users/getProfile
 *
 * All requests go through `call()`, which refreshes the token on 401 and
 * surfaces 429 rate-limiting as a typed error, mirroring the Fitbit provider.
 * Device-dependent signals fail soft (return null/[]) via `callSoft()`.
 *
 * Tokens are NOT transferable from Fitbit — see oauth.ts. When the host has not
 * registered a Google OAuth app (googleHealthConfigured === false) there is no
 * token in the store, so isConnected() is false and every read fails soft: the
 * provider is code-complete but inert until the user connects.
 */
import {
  type ActivityLogInput,
  type ActivityLogResult,
  type BreathingReading,
  type CardioScore,
  type DailyActivity,
  type DayHeartRate,
  type Exercise,
  type HealthProvider,
  type HeartRatePoint,
  type HeartRateZone,
  type HrvReading,
  type SkinTempReading,
  type SleepSummary,
  type Spo2Reading,
  type UserProfile,
  type WeightReading,
  NotConnectedError,
} from "../types";
import {
  getFreshTokens,
  refreshTokens,
  type GoogleHealthTokens,
  type GoogleTokenStore,
} from "./oauth";

const API = "https://health.googleapis.com/v4";

/**
 * Verified data type identifiers (kebab-case path segments) from
 * https://developers.google.com/health/data-types. The snake_case form is used
 * inside filter expressions.
 */
const DT = {
  heartRate: "heart-rate",
  dailyRestingHeartRate: "daily-resting-heart-rate",
  dailyHeartRateZones: "daily-heart-rate-zones",
  sleep: "sleep",
  steps: "steps",
  distance: "distance",
  totalCalories: "total-calories",
  activeMinutes: "active-minutes",
  floors: "floors",
  weight: "weight",
  bodyFat: "body-fat",
  height: "height",
  hrvDaily: "daily-heart-rate-variability",
  respiratoryDaily: "daily-respiratory-rate",
  spo2Daily: "daily-oxygen-saturation",
  sleepTempDaily: "daily-sleep-temperature-derivations",
  dailyVo2Max: "daily-vo2-max",
  runVo2Max: "run-vo2-max",
  exercise: "exercise",
} as const;

export class GoogleHealthRateLimitError extends Error {
  retryAfterSec: number;
  constructor(retryAfterSec: number) {
    super(`Google Health rate limit hit; retry after ${retryAfterSec}s`);
    this.name = "GoogleHealthRateLimitError";
    this.retryAfterSec = retryAfterSec;
  }
}

// ── Raw response shapes (only the fields we read) ───────────────────────────
// Per the DataPoint reference, each point is { name, dataSource, <typedMember> }
// where the typed member is the camelCase version of the kebab data type.

interface ObservationSampleTime {
  physicalTime?: string; // RFC 3339
  civilTime?: string;
}
interface TimeInterval {
  startTime?: string; // RFC 3339
  endTime?: string;
}
interface GhDate {
  year?: number;
  month?: number;
  day?: number;
}

interface DataPoint {
  name?: string;
  heartRate?: { sampleTime?: ObservationSampleTime; beatsPerMinute?: string };
  dailyRestingHeartRate?: { date?: GhDate; beatsPerMinute?: string };
  dailyHeartRateZones?: {
    date?: GhDate;
    zones?: Array<{
      type?: string;
      minBeatsPerMinute?: number;
      maxBeatsPerMinute?: number;
      minutes?: number | string;
    }>;
  };
  sleep?: {
    interval?: TimeInterval;
    summary?: {
      minutesInSleepPeriod?: number | string;
      minutesAsleep?: number | string;
      minutesAwake?: number | string;
      stagesSummary?: Array<{ type?: string; minutes?: number | string }>;
    };
  };
  steps?: { interval?: TimeInterval; count?: number | string };
  distance?: { interval?: TimeInterval; millimeters?: number | string };
  totalCalories?: { interval?: TimeInterval; kilocalories?: number | string };
  activeMinutes?: { interval?: TimeInterval; minutes?: number | string };
  floors?: { interval?: TimeInterval; count?: number | string };
  weight?: { sampleTime?: ObservationSampleTime; weightGrams?: number };
  bodyFat?: { sampleTime?: ObservationSampleTime; percentage?: number };
  height?: { sampleTime?: ObservationSampleTime; heightMeters?: number };
  dailyHeartRateVariability?: {
    date?: GhDate;
    averageHeartRateVariabilityMilliseconds?: number;
    deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds?: number;
  };
  dailyRespiratoryRate?: {
    date?: GhDate;
    averageBreathsPerMinute?: number;
    breathsPerMinute?: number;
  };
  dailyOxygenSaturation?: {
    date?: GhDate;
    averagePercentage?: number;
    lowerBoundPercentage?: number;
  };
  dailySleepTemperatureDerivations?: {
    date?: GhDate;
    nightlyTemperatureCelsius?: number;
    baselineTemperatureCelsius?: number;
  };
  dailyVo2Max?: { date?: GhDate; vo2Max?: number };
  runVo2Max?: { sampleTime?: ObservationSampleTime; runVo2Max?: number };
  exercise?: {
    interval?: TimeInterval;
    exerciseType?: string;
    displayName?: string;
    activeDuration?: string; // duration like "1800s"
    exerciseMetadata?: { autoDetected?: boolean };
    metricsSummary?: {
      distanceMillimeters?: number;
      caloriesKcal?: number;
      averageHeartRateBeatsPerMinute?: string;
    };
  };
}

interface ListResp {
  dataPoints?: DataPoint[];
  nextPageToken?: string;
}

interface ProfileResp {
  // https://developers.google.com/health/reference/rest/v4/users/getProfile
  dateOfBirth?: GhDate;
  age?: number;
  gender?: string; // "MALE" | "FEMALE" | ... per API enum
  sex?: string;
}

export class GoogleHealthProvider implements HealthProvider {
  readonly name = "Google Health";

  /** Token persistence is injected (cookie store now, DB store in Phase 2). */
  constructor(private readonly store: GoogleTokenStore) {}

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
    tokens: GoogleHealthTokens,
    path: string,
    init: RequestInit,
    retried: boolean,
  ): Promise<T> {
    const res = await fetch(`${API}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${tokens.accessToken}`,
        Accept: "application/json",
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
      // Google returns standard Retry-After (seconds) on quota exhaustion.
      throw new GoogleHealthRateLimitError(
        Number(res.headers.get("Retry-After") || "3600"),
      );
    }
    if (!res.ok) {
      throw new Error(`Google Health ${path} → ${res.status} ${await res.text()}`);
    }
    if (res.status === 204) return {} as T;
    return (await res.json()) as T;
  }

  /**
   * Fail-soft GET for device-dependent signals. Returns null when the field is
   * simply absent (404 / empty body) — many of these signals require a
   * compatible device or a night of data and are legitimately missing.
   * Authentication failures still surface as NotConnectedError, and rate
   * limiting still surfaces as GoogleHealthRateLimitError (both thrown by call()).
   */
  private async callSoft<T>(path: string): Promise<T | null> {
    try {
      return await this.call<T>(path);
    } catch (err) {
      if (
        err instanceof NotConnectedError ||
        err instanceof GoogleHealthRateLimitError
      ) {
        throw err;
      }
      return null;
    }
  }

  // ── helpers ───────────────────────────────────────────────────────────────

  /**
   * Build a dataPoints.list URL for an interval-based data type over a single
   * UTC calendar day. The filter uses the snake_case type with `.interval` and
   * RFC-3339 bounds (verified filter syntax, e.g.
   * `steps.interval.start_time >= "..."`).
   */
  private intervalDayPath(
    kebabType: string,
    date: string,
    pageSize = 1440,
  ): string {
    const snake = kebabType.replace(/-/g, "_");
    const filter = `${snake}.interval.start_time >= "${date}T00:00:00Z" AND ${snake}.interval.start_time < "${nextDay(date)}T00:00:00Z"`;
    const params = new URLSearchParams({
      filter,
      pageSize: String(pageSize),
    });
    return `/users/me/dataTypes/${kebabType}/dataPoints?${params.toString()}`;
  }

  /** Same as intervalDayPath but for sample-based (point-in-time) data types. */
  private sampleRangePath(
    kebabType: string,
    fromDate: string,
    toDateExclusive: string,
    pageSize = 10000,
  ): string {
    const snake = kebabType.replace(/-/g, "_");
    const filter = `${snake}.sample_time.physical_time >= "${fromDate}T00:00:00Z" AND ${snake}.sample_time.physical_time < "${toDateExclusive}T00:00:00Z"`;
    const params = new URLSearchParams({ filter, pageSize: String(pageSize) });
    return `/users/me/dataTypes/${kebabType}/dataPoints?${params.toString()}`;
  }

  /** dataPoints.list URL for a daily-summary data type (filter on `.date`). */
  private dailySummaryPath(kebabType: string, date: string): string {
    const snake = kebabType.replace(/-/g, "_");
    // Daily-summary types key on a civil date (ISO 8601). One day is
    // [date, date].
    const filter = `${snake}.date >= "${date}" AND ${snake}.date <= "${date}"`;
    const params = new URLSearchParams({ filter, pageSize: "2" });
    return `/users/me/dataTypes/${kebabType}/dataPoints?${params.toString()}`;
  }

  /** Sum a numeric (string|number) interval value over a day's data points. */
  private static sumField(
    points: DataPoint[] | undefined,
    pick: (p: DataPoint) => number | string | undefined,
  ): number {
    let total = 0;
    for (const p of points ?? []) {
      total += num(pick(p));
    }
    return total;
  }

  // ── HealthProvider methods ──────────────────────────────────────────────────

  async getHeartRateForDay(
    date: string,
    withIntraday: boolean,
  ): Promise<DayHeartRate> {
    // Resting HR (daily summary) and HR zones (daily summary) come from their
    // own daily data types; intraday is the per-sample heart-rate stream.
    const next = nextDay(date);
    const [restJ, zonesJ, intraJ] = await Promise.all([
      this.callSoft<ListResp>(
        this.dailySummaryPath(DT.dailyRestingHeartRate, date),
      ),
      this.callSoft<ListResp>(
        this.dailySummaryPath(DT.dailyHeartRateZones, date),
      ),
      withIntraday
        ? this.callSoft<ListResp>(this.sampleRangePath(DT.heartRate, date, next))
        : Promise.resolve(null),
    ]);

    const restingHr =
      numOrNull(restJ?.dataPoints?.[0]?.dailyRestingHeartRate?.beatsPerMinute);

    const zones: HeartRateZone[] =
      zonesJ?.dataPoints?.[0]?.dailyHeartRateZones?.zones?.map((z) => ({
        name: zoneName(z.type),
        min: z.minBeatsPerMinute ?? 0,
        max: z.maxBeatsPerMinute ?? 0,
        minutes: num(z.minutes),
      })) ?? [];

    const intraday: HeartRatePoint[] =
      intraJ?.dataPoints
        ?.map((p): HeartRatePoint | null => {
          const ts = p.heartRate?.sampleTime?.physicalTime;
          const bpm = numOrNull(p.heartRate?.beatsPerMinute);
          if (!ts || bpm === null) return null;
          return { t: new Date(ts).getTime(), bpm };
        })
        .filter((x): x is HeartRatePoint => x !== null)
        .sort((a, b) => a.t - b.t) ?? [];

    return { date, restingHr, zones, intraday };
  }

  async getSleep(date: string): Promise<SleepSummary | null> {
    // Sleep is a session keyed by its interval; we want the session whose wake
    // (interval.end_time) falls on `date`. We query a 2-day window ending on
    // `date` and pick the session ending on the requested calendar day.
    const snake = DT.sleep.replace(/-/g, "_");
    const filter = `${snake}.interval.end_time >= "${date}T00:00:00Z" AND ${snake}.interval.end_time < "${nextDay(date)}T00:00:00Z"`;
    const params = new URLSearchParams({ filter, pageSize: "25" });
    const j = await this.callSoft<ListResp>(
      `/users/me/dataTypes/${DT.sleep}/dataPoints?${params.toString()}`,
    );
    const sleep = j?.dataPoints?.[0]?.sleep;
    const summary = sleep?.summary;
    if (!summary) return null;

    const asleepMin = num(summary.minutesAsleep);
    if (asleepMin <= 0) return null;
    const period = num(summary.minutesInSleepPeriod);
    const awakeMin = num(summary.minutesAwake);
    // The API exposes no explicit "time in bed" or "efficiency"; derive both
    // from the sleep-period total (sum of all stages incl. AWAKE) and asleep.
    const inBedMin = period > 0 ? period : asleepMin + awakeMin;
    const efficiency =
      inBedMin > 0 ? Math.round((asleepMin / inBedMin) * 100) : 0;

    const stages = stagesFromSummary(summary.stagesSummary);

    return {
      date,
      asleepMin,
      inBedMin,
      efficiency,
      ...(stages ? { stages } : {}),
    };
  }

  async getDailyActivity(date: string): Promise<DailyActivity | null> {
    // No single daily-activity summary type; aggregate the interval types over
    // the day (verified types: steps, distance, total-calories, active-minutes,
    // floors). Each is summed across that day's data points.
    const [stepsJ, distJ, calJ, activeJ, floorsJ] = await Promise.all([
      this.callSoft<ListResp>(this.intervalDayPath(DT.steps, date)),
      this.callSoft<ListResp>(this.intervalDayPath(DT.distance, date)),
      this.callSoft<ListResp>(this.intervalDayPath(DT.totalCalories, date)),
      this.callSoft<ListResp>(this.intervalDayPath(DT.activeMinutes, date)),
      this.callSoft<ListResp>(this.intervalDayPath(DT.floors, date)),
    ]);

    const steps = GoogleHealthProvider.sumField(
      stepsJ?.dataPoints,
      (p) => p.steps?.count,
    );
    const distanceMm = GoogleHealthProvider.sumField(
      distJ?.dataPoints,
      (p) => p.distance?.millimeters,
    );
    const caloriesOut = GoogleHealthProvider.sumField(
      calJ?.dataPoints,
      (p) => p.totalCalories?.kilocalories,
    );
    const activeMinutes = GoogleHealthProvider.sumField(
      activeJ?.dataPoints,
      (p) => p.activeMinutes?.minutes,
    );
    const floors = GoogleHealthProvider.sumField(
      floorsJ?.dataPoints,
      (p) => p.floors?.count,
    );

    // If every signal is empty, treat the day as having no activity data.
    if (
      steps === 0 &&
      distanceMm === 0 &&
      caloriesOut === 0 &&
      activeMinutes === 0 &&
      floors === 0
    ) {
      return null;
    }

    return {
      date,
      steps,
      distanceKm: distanceMm / 1_000_000, // mm → km
      caloriesOut,
      activeMinutes,
      ...(floors > 0 ? { floors } : {}),
    };
  }

  async getWeightLog(fromDate: string, toDate: string): Promise<WeightReading[]> {
    // weight is a sample-based type (weightGrams at a sampleTime). body-fat is a
    // separate sample type; BMI is not exposed by Google Health, so left unset.
    const next = nextDay(toDate);
    const j = await this.callSoft<ListResp>(
      this.sampleRangePath(DT.weight, fromDate, next),
    );
    return (j?.dataPoints ?? [])
      .map((p): WeightReading | null => {
        const grams = p.weight?.weightGrams;
        const ts = p.weight?.sampleTime?.physicalTime;
        if (typeof grams !== "number" || !ts) return null;
        const reading: WeightReading = {
          t: new Date(ts).getTime(),
          weightKg: grams / 1000,
        };
        // bmi is not provided by the Google Health weight type → omitted.
        return reading;
      })
      .filter((x): x is WeightReading => x !== null)
      .sort((a, b) => a.t - b.t);
  }

  async logActivity(_input: ActivityLogInput): Promise<ActivityLogResult> {
    // The Google Health API's overview states write support "will" come for all
    // types and expanded endpoints, and the documented *.writeonly OAuth scopes
    // exist, but a public write/create path for an activity/exercise session is
    // not yet generally available at the time of writing (verified May 2026 at
    // https://developers.google.com/health and /health/scopes). Rather than fake
    // a no-op success, fail loudly so the host keeps using Fitbit for writes
    // until Google Health write is live.
    throw new Error(
      "logActivity is not yet supported by the Google Health API (write endpoints pending). Use the Fitbit provider for activity writes until Google Health write GA.",
    );
  }

  async getHrv(date: string): Promise<HrvReading | null> {
    const j = await this.callSoft<ListResp>(
      this.dailySummaryPath(DT.hrvDaily, date),
    );
    const v = j?.dataPoints?.[0]?.dailyHeartRateVariability;
    const rmssd =
      v?.averageHeartRateVariabilityMilliseconds ??
      v?.deepSleepRootMeanSquareOfSuccessiveDifferencesMilliseconds;
    if (typeof rmssd !== "number") return null;
    // Google Health does not expose a per-night coverage fraction → omitted.
    return { date, rmssd };
  }

  async getBreathingRate(date: string): Promise<BreathingReading | null> {
    const j = await this.callSoft<ListResp>(
      this.dailySummaryPath(DT.respiratoryDaily, date),
    );
    const v = j?.dataPoints?.[0]?.dailyRespiratoryRate;
    const bpm = v?.averageBreathsPerMinute ?? v?.breathsPerMinute;
    if (typeof bpm !== "number") return null;
    return { date, breathsPerMin: bpm };
  }

  async getSpo2(date: string): Promise<Spo2Reading | null> {
    const j = await this.callSoft<ListResp>(
      this.dailySummaryPath(DT.spo2Daily, date),
    );
    const v = j?.dataPoints?.[0]?.dailyOxygenSaturation;
    if (typeof v?.averagePercentage !== "number") return null;
    return {
      date,
      avgPct: v.averagePercentage,
      // Google reports a lower-bound (confidence interval), not a true min, but
      // it is the closest available analogue to Fitbit's minPct.
      ...(typeof v.lowerBoundPercentage === "number"
        ? { minPct: v.lowerBoundPercentage }
        : {}),
    };
  }

  async getSkinTemp(date: string): Promise<SkinTempReading | null> {
    const j = await this.callSoft<ListResp>(
      this.dailySummaryPath(DT.sleepTempDaily, date),
    );
    const v = j?.dataPoints?.[0]?.dailySleepTemperatureDerivations;
    if (typeof v?.nightlyTemperatureCelsius !== "number") return null;
    // Our domain type wants the deviation from baseline. Google gives absolute
    // nightly + baseline; relative = nightly - baseline.
    const baseline = v.baselineTemperatureCelsius;
    const relativeC =
      typeof baseline === "number"
        ? v.nightlyTemperatureCelsius - baseline
        : v.nightlyTemperatureCelsius;
    return { date, relativeC };
  }

  async getCardioScore(date: string): Promise<CardioScore | null> {
    // Prefer the daily VO2max summary; fall back to the most recent run VO2max
    // sample within the day. Google does not publish a low/high range, so
    // CardioScore.range is left unset.
    const dailyJ = await this.callSoft<ListResp>(
      this.dailySummaryPath(DT.dailyVo2Max, date),
    );
    const daily = dailyJ?.dataPoints?.[0]?.dailyVo2Max?.vo2Max;
    if (typeof daily === "number") return { date, vo2max: daily };

    const runJ = await this.callSoft<ListResp>(
      this.sampleRangePath(DT.runVo2Max, date, nextDay(date), 25),
    );
    const run = runJ?.dataPoints?.[0]?.runVo2Max?.runVo2Max;
    if (typeof run === "number") return { date, vo2max: run };
    return null;
  }

  async getExercises(date: string): Promise<Exercise[]> {
    // exercise is a session keyed by interval; pageSize for exercise is capped
    // at 25 per the list docs. We fetch sessions starting on the calendar day.
    const snake = DT.exercise.replace(/-/g, "_");
    const filter = `${snake}.interval.start_time >= "${date}T00:00:00Z" AND ${snake}.interval.start_time < "${nextDay(date)}T00:00:00Z"`;
    const params = new URLSearchParams({ filter, pageSize: "25" });
    const j = await this.callSoft<ListResp>(
      `/users/me/dataTypes/${DT.exercise}/dataPoints?${params.toString()}`,
    );
    const out: Exercise[] = [];
    for (const p of j?.dataPoints ?? []) {
      const ex = p.exercise;
      const start = ex?.interval?.startTime;
      if (!ex || !start) continue;
      const startTime = new Date(start);
      const durationSec = durationToSec(
        ex.activeDuration,
        ex.interval?.startTime,
        ex.interval?.endTime,
      );
      const m = ex.metricsSummary;
      // Stable id: Google's data point resource name (users/.../dataPoints/{id}).
      const id = p.name ?? `${DT.exercise}:${start}`;
      const exercise: Exercise = {
        id,
        startTime,
        durationSec,
        type: ex.displayName || prettifyType(ex.exerciseType) || "Workout",
        source: ex.exerciseMetadata?.autoDetected ? "auto" : "manual",
        ...(typeof m?.distanceMillimeters === "number"
          ? { distanceM: m.distanceMillimeters / 1000 }
          : {}),
        ...(typeof m?.caloriesKcal === "number"
          ? { calories: m.caloriesKcal }
          : {}),
        ...(numOrNull(m?.averageHeartRateBeatsPerMinute) !== null
          ? { avgHr: numOrNull(m?.averageHeartRateBeatsPerMinute) as number }
          : {}),
        // Per-exercise HR-zone breakdown is not exposed on the exercise
        // metricsSummary → hrZones left unset.
      };
      out.push(exercise);
    }
    return out;
  }

  async getProfile(): Promise<UserProfile | null> {
    // Profile is its own resource (not a data type):
    // GET /v4/users/me/profile
    const j = await this.callSoft<ProfileResp>("/users/me/profile");
    if (!j) return null;
    const profile: UserProfile = {};
    if (typeof j.age === "number") {
      profile.age = j.age;
    } else if (j.dateOfBirth?.year) {
      profile.age = ageFromDob(j.dateOfBirth);
    }
    const sex = mapSex(j.gender ?? j.sex);
    if (sex) profile.sex = sex;
    // Height/weight come from their own measurement data types, not the
    // profile resource; populated from getWeightLog / a height read elsewhere.
    // waistCm is not exposed by Google Health → left undefined.
    return Object.keys(profile).length ? profile : null;
  }
}

// ── pure helpers ──────────────────────────────────────────────────────────────

function nextDay(date: string): string {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

function num(v: number | string | undefined): number {
  if (typeof v === "number") return v;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : 0;
  }
  return 0;
}

function numOrNull(v: number | string | undefined): number | null {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  if (typeof v === "string") {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/** Map Google HeartRateZoneType enum → Fitbit-style zone label. */
function zoneName(type: string | undefined): string {
  switch (type) {
    case "FAT_BURN":
      return "Fat Burn";
    case "CARDIO":
      return "Cardio";
    case "PEAK":
      return "Peak";
    case "OUT_OF_RANGE":
      return "Out of Range";
    default:
      return type ?? "";
  }
}

/** Sum Google SleepStageType minutes into our deep/light/rem/wake buckets. */
function stagesFromSummary(
  stagesSummary:
    | Array<{ type?: string; minutes?: number | string }>
    | undefined,
): { deep: number; light: number; rem: number; wake: number } | undefined {
  if (!stagesSummary || stagesSummary.length === 0) return undefined;
  const acc = { deep: 0, light: 0, rem: 0, wake: 0 };
  let any = false;
  for (const s of stagesSummary) {
    const m = num(s.minutes);
    switch (s.type) {
      case "DEEP":
        acc.deep += m;
        any = true;
        break;
      case "LIGHT":
        acc.light += m;
        any = true;
        break;
      case "REM":
        acc.rem += m;
        any = true;
        break;
      case "AWAKE":
        acc.wake += m;
        any = true;
        break;
      // ASLEEP / RESTLESS have no dedicated bucket; folded into light.
      case "ASLEEP":
      case "RESTLESS":
        acc.light += m;
        any = true;
        break;
      default:
        break;
    }
  }
  return any ? acc : undefined;
}

/** "RUNNING" → "Running"; "STRENGTH_TRAINING" → "Strength Training". */
function prettifyType(type: string | undefined): string {
  if (!type) return "";
  return type
    .toLowerCase()
    .split("_")
    .map((w) => (w ? w[0]!.toUpperCase() + w.slice(1) : w))
    .join(" ");
}

/** Google Duration string ("1800s") → seconds, falling back to the interval. */
function durationToSec(
  duration: string | undefined,
  start: string | undefined,
  end: string | undefined,
): number {
  if (duration && duration.endsWith("s")) {
    const n = Number(duration.slice(0, -1));
    if (Number.isFinite(n)) return Math.round(n);
  }
  if (start && end) {
    const diff = new Date(end).getTime() - new Date(start).getTime();
    if (Number.isFinite(diff) && diff > 0) return Math.round(diff / 1000);
  }
  return 0;
}

function mapSex(gender: string | undefined): UserProfile["sex"] | undefined {
  switch ((gender ?? "").toUpperCase()) {
    case "MALE":
      return "male";
    case "FEMALE":
      return "female";
    case "UNSPECIFIED":
    case "OTHER":
    case "NA":
      return "unspecified";
    default:
      return undefined;
  }
}

function ageFromDob(dob: GhDate): number | undefined {
  if (!dob.year) return undefined;
  const now = new Date();
  let age = now.getUTCFullYear() - dob.year;
  const m = (dob.month ?? 1) - 1;
  const d = dob.day ?? 1;
  const beforeBirthday =
    now.getUTCMonth() < m ||
    (now.getUTCMonth() === m && now.getUTCDate() < d);
  if (beforeBirthday) age -= 1;
  return age >= 0 ? age : undefined;
}
// The provider is constructed per request with an injected GoogleTokenStore —
// see the host's google-health store factory (no module-level singleton).
