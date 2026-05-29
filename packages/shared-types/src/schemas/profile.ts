import { z } from "zod";

/**
 * User profile schemas — §3 of docs/architecture/02-API-CONTRACT.md.
 *
 * The profile supplies the static attributes needed for honest metrics (HRmax,
 * Fitness Age, BMR, norm-table lookups). Field names follow the API-CONTRACT
 * (`ageYears`, `sex`, `heightCm`, `waistCm`, `restingHrOverride?`,
 * `maxHrOverride?`); every field is nullable until the user sets it. Setting
 * age/sex/height flips `capabilities.fitnessAge`.
 */

/** Biological sex; norm tables are sex-specific (mirrors UserProfile.sex). */
export const Sex = z.enum(["male", "female", "unspecified"]);
export type Sex = z.infer<typeof Sex>;

/** `GET /v1/profile` response. Nullable until captured progressively. */
export const ProfileResponse = z.object({
  ageYears: z.number().int().nullable(),
  sex: Sex.nullable(),
  heightCm: z.number().nullable(),
  waistCm: z.number().nullable(),
  /** Measured resting HR override; else provider/age-derived. */
  restingHrOverride: z.number().int().nullable().optional(),
  /** Measured max HR override; else age-derived. */
  maxHrOverride: z.number().int().nullable().optional(),
});
export type ProfileResponse = z.infer<typeof ProfileResponse>;

/**
 * `PATCH /v1/profile` request. Partial update; same shape as the response but
 * every field optional. `null` clears a value, omission leaves it unchanged.
 */
export const ProfileUpdateRequest = z.object({
  ageYears: z.number().int().nullable().optional(),
  sex: Sex.nullable().optional(),
  heightCm: z.number().nullable().optional(),
  waistCm: z.number().nullable().optional(),
  restingHrOverride: z.number().int().nullable().optional(),
  maxHrOverride: z.number().int().nullable().optional(),
});
export type ProfileUpdateRequest = z.infer<typeof ProfileUpdateRequest>;
