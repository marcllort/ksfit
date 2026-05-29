import { z } from "zod";
import { EpochMs, RangeQuery } from "./metrics";

/**
 * Exercise (provider-detected workout) schemas — §5.2 of
 * docs/architecture/02-API-CONTRACT.md. Mirrors the `Exercise` /
 * `HeartRateZone` / `HeartRatePoint` types in packages/health-core/src/types.ts,
 * but on the wire `startTime` is epoch-ms (a number, not a Date) and distance is
 * surfaced as `distanceKm` per the contract example.
 */

/** Time-in-zone breakdown (mirrors HeartRateZone). */
export const ExerciseHrZone = z.object({
  name: z.string(),
  minutes: z.number(),
});
export type ExerciseHrZone = z.infer<typeof ExerciseHrZone>;

/** One intraday HR sample for an exercise (mirrors HeartRatePoint). */
export const ExerciseHrPoint = z.object({
  t: EpochMs,
  bpm: z.number(),
});
export type ExerciseHrPoint = z.infer<typeof ExerciseHrPoint>;

/** List-item shape: summary, no HR series. */
export const ExerciseListItem = z.object({
  /** Stable provider id for the logged activity, e.g. "fitbit_123". */
  id: z.string(),
  /** Activity type/name, e.g. "Run", "Walk", "Weights". */
  type: z.string(),
  /** Start instant, epoch-ms UTC. */
  startTime: EpochMs,
  durationSec: z.number(),
  distanceKm: z.number().optional(),
  /** kcal. */
  calories: z.number().optional(),
  avgHr: z.number().optional(),
  /** SmartTrack auto-detection vs a manually-logged session. */
  autoDetected: z.boolean(),
  zones: z.array(ExerciseHrZone).optional(),
});
export type ExerciseListItem = z.infer<typeof ExerciseListItem>;

/** Detail shape: list item + the intraday HR series. */
export const ExerciseDetail = ExerciseListItem.extend({
  /** Intraday HR series; Google HR is Sample granularity (validated at migration). */
  hr: z.array(ExerciseHrPoint),
});
export type ExerciseDetail = z.infer<typeof ExerciseDetail>;

/** `GET /v1/exercises` query: range + pagination. */
export const ExerciseListQuery = RangeQuery.extend({
  limit: z.number().int().min(1).max(200).optional(),
  cursor: z.string().optional(),
});
export type ExerciseListQuery = z.infer<typeof ExerciseListQuery>;

/** `GET /v1/exercises` response (paginated list envelope). */
export const ExerciseListResponse = z.object({
  items: z.array(ExerciseListItem),
  nextCursor: z.string().nullable(),
});
export type ExerciseListResponse = z.infer<typeof ExerciseListResponse>;

/** `GET /v1/exercises/:id` response. */
export const ExerciseDetailResponse = ExerciseDetail;
export type ExerciseDetailResponse = z.infer<typeof ExerciseDetailResponse>;
