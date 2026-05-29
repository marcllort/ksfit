import { z } from "zod";

/**
 * Health-metric API schemas (§4 of docs/architecture/02-API-CONTRACT.md).
 *
 * Conventions mirrored from the contract and packages/health-core/src/types.ts:
 * - Dates are `YYYY-MM-DD` (local wake-date for sleep).
 * - Instants are Unix epoch **milliseconds, UTC** (`t`), matching HeartRatePoint.t.
 * - Derived metrics carry an explicit `unit` string + provenance via MetricValue.
 * - `estimate: true` marks self-derived/approximated scores (Recovery, Strain,
 *   Stress, Fitness Age) so the UI and coach never claim provider/WHOOP parity.
 */

/* -------------------------------------------------------------------------- */
/* Shared primitives                                                          */
/* -------------------------------------------------------------------------- */

/** `YYYY-MM-DD` calendar date. */
export const DateString = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "expected YYYY-MM-DD");
export type DateString = z.infer<typeof DateString>;

/** Unix epoch milliseconds, UTC. */
export const EpochMs = z.number().int();
export type EpochMs = z.infer<typeof EpochMs>;

/**
 * Provenance of a value. Provider names (`fitbit`/`google`/`ksfit`) mark direct
 * device data; `derived`/`estimate` mark backend-computed scores. The
 * data-model uses the coarser `device|derived|estimate`; the API-CONTRACT
 * examples cite the provider name — both are accepted here.
 */
export const MetricSource = z.enum([
  "fitbit",
  "google",
  "ksfit",
  "device",
  "derived",
  "estimate",
]);
export type MetricSource = z.infer<typeof MetricSource>;

/**
 * The standard value envelope every derived metric returns so the coach + UI
 * can cite provenance. `MetricValue` in the contract §4.
 */
export const MetricValue = z.object({
  value: z.number(),
  unit: z.string(),
  /** As-of calendar date for this value. */
  asOf: DateString,
  source: MetricSource,
  /** True for self-derived/approximated metrics; absent ⇒ direct reading. */
  estimate: z.boolean().optional(),
});
export type MetricValue = z.infer<typeof MetricValue>;

/** Nullable MetricValue (e.g. snapshot fields that may be absent). */
export const NullableMetricValue = MetricValue.nullable();
export type NullableMetricValue = z.infer<typeof NullableMetricValue>;

/** Trend direction shared by HRV / weight / etc. series. */
export const Trend = z.enum(["rising", "flat", "falling"]);
export type Trend = z.infer<typeof Trend>;

/** Query shape for a single day. */
export const DateQuery = z.object({
  date: DateString.optional(),
});
export type DateQuery = z.infer<typeof DateQuery>;

/** Query shape for a date range (inclusive `YYYY-MM-DD` endpoints). */
export const RangeQuery = z.object({
  from: DateString.optional(),
  to: DateString.optional(),
});
export type RangeQuery = z.infer<typeof RangeQuery>;

/* -------------------------------------------------------------------------- */
/* 4.1 Recovery                                                               */
/* -------------------------------------------------------------------------- */

/** One weighted component of the Recovery score (z-score vs personal EWMA). */
export const RecoveryComponent = z.object({
  /** z-score vs the personal EWMA baseline (RHR/breathing are inverted). */
  z: z.number(),
  /** Stride's own weight in the blend (shown for transparency). */
  weight: z.number(),
  metric: MetricValue,
});
export type RecoveryComponent = z.infer<typeof RecoveryComponent>;

export const RecoveryResponse = z.object({
  date: DateString,
  /** 0–100 recovery percentage; always an estimate. */
  score: MetricValue,
  label: z.literal("Recovery (Stride estimate)"),
  components: z.object({
    hrv: RecoveryComponent,
    restingHr: RecoveryComponent,
    breathingRate: RecoveryComponent,
    sleep: RecoveryComponent,
  }),
});
export type RecoveryResponse = z.infer<typeof RecoveryResponse>;

/* -------------------------------------------------------------------------- */
/* 4.2 Strain (Day Strain)                                                    */
/* -------------------------------------------------------------------------- */

/** Time-in-zone minutes for the strain breakdown. */
export const StrainZone = z.object({
  name: z.string(),
  minutes: z.number(),
});
export type StrainZone = z.infer<typeof StrainZone>;

export const StrainResponse = z.object({
  date: DateString,
  /** 0–21 day-strain, self-calibrated to the user's own distribution. */
  strain: MetricValue,
  method: z.literal("banister_trimp_hrr"),
  /** Mapped to the user's own 90-day TRIMP distribution. */
  selfCalibrated: z.boolean(),
  zones: z.array(StrainZone),
  /** Raw Banister TRIMP before the 0–21 log-map. */
  trimp: z.number(),
});
export type StrainResponse = z.infer<typeof StrainResponse>;

/* -------------------------------------------------------------------------- */
/* 4.3 Sleep (incl. need + debt)                                              */
/* -------------------------------------------------------------------------- */

/** Sleep-stage minutes (mirrors SleepSummary.stages). */
export const SleepStages = z.object({
  deep: z.number(),
  light: z.number(),
  rem: z.number(),
  wake: z.number(),
});
export type SleepStages = z.infer<typeof SleepStages>;

/** Dynamic sleep need: baseline + debt adj + strain adj (α/β coefficients ours). */
export const SleepNeed = z.object({
  value: z.number(),
  unit: z.literal("min"),
  estimate: z.literal(true),
  breakdown: z.object({
    baseline: z.number(),
    debtAdj: z.number(),
    strainAdj: z.number(),
  }),
});
export type SleepNeed = z.infer<typeof SleepNeed>;

/** Decaying 5-night sleep-debt accumulator. */
export const SleepDebt = z.object({
  value: z.number(),
  unit: z.literal("min"),
  estimate: z.literal(true),
  window: z.literal("5-night-decay"),
});
export type SleepDebt = z.infer<typeof SleepDebt>;

/** Age-normal stage ranges, `[low, high]` percentages. */
export const SleepStageNorms = z.object({
  deepPct: z.tuple([z.number(), z.number()]),
  remPct: z.tuple([z.number(), z.number()]),
});
export type SleepStageNorms = z.infer<typeof SleepStageNorms>;

export const SleepResponse = z.object({
  date: DateString,
  /** Direct data (SleepSummary). */
  asleepMin: z.number(),
  inBedMin: z.number(),
  efficiency: z.number(), // 0–100
  stages: SleepStages.optional(),
  /** Asleep ÷ need, 0–100, derived. */
  performance: MetricValue,
  need: SleepNeed,
  debt: SleepDebt,
  stageNorms: SleepStageNorms,
});
export type SleepResponse = z.infer<typeof SleepResponse>;

/* -------------------------------------------------------------------------- */
/* 4.4 HRV (series + band)                                                    */
/* -------------------------------------------------------------------------- */

/** One nightly RMSSD point (mirrors HrvReading, ms). */
export const HrvPoint = z.object({
  date: DateString,
  rmssd: z.number(),
});
export type HrvPoint = z.infer<typeof HrvPoint>;

/** Personal EWMA baseline band — the band IS the target. */
export const HrvBaseline = z.object({
  unit: z.literal("ms"),
  method: z.literal("ewma_ln_rmssd_30d"),
  mid: z.number(),
  low: z.number(),
  high: z.number(),
});
export type HrvBaseline = z.infer<typeof HrvBaseline>;

export const HrvResponse = z.object({
  points: z.array(HrvPoint),
  baseline: HrvBaseline,
  latest: MetricValue,
  trend: Trend,
});
export type HrvResponse = z.infer<typeof HrvResponse>;

/* -------------------------------------------------------------------------- */
/* 4.5 Stress (HR-based estimate)                                             */
/* -------------------------------------------------------------------------- */

/** Intraday stress level point (epoch-ms instant). */
export const StressPoint = z.object({
  t: EpochMs,
  level: z.number(),
});
export type StressPoint = z.infer<typeof StressPoint>;

export const StressResponse = z.object({
  date: DateString,
  label: z.literal("Stress (HR-based estimate)"),
  /** 0–100; always an estimate. */
  score: MetricValue,
  method: z.literal("hr_arousal_vs_resting_exercise_excluded"),
  /** Optional, may be empty. */
  intraday: z.array(StressPoint),
});
export type StressResponse = z.infer<typeof StressResponse>;

/* -------------------------------------------------------------------------- */
/* 4.6 Fitness Age                                                            */
/* -------------------------------------------------------------------------- */

export const FitnessAgeResponse = z.object({
  label: z.literal("Fitness Age (cardiorespiratory)"),
  fitnessAge: MetricValue,
  vo2max: MetricValue,
  method: z.enum(["vo2max_norm_tables", "non_exercise_regression"]),
  chronologicalAge: z.number(),
});
export type FitnessAgeResponse = z.infer<typeof FitnessAgeResponse>;

/* -------------------------------------------------------------------------- */
/* 4.7 Daily calories / activity summary                                      */
/* -------------------------------------------------------------------------- */

/** Mirrors DailyActivity. Direct provider data. */
export const DailyActivityResponse = z.object({
  date: DateString,
  steps: z.number(),
  distanceKm: z.number(),
  caloriesOut: z.number(),
  activeMinutes: z.number(),
  floors: z.number().optional(),
});
export type DailyActivityResponse = z.infer<typeof DailyActivityResponse>;

/** A range request returns a series of daily activity summaries. */
export const DailyActivitySeriesResponse = z.object({
  items: z.array(DailyActivityResponse),
});
export type DailyActivitySeriesResponse = z.infer<
  typeof DailyActivitySeriesResponse
>;
