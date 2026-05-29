/**
 * Coach tools (grounding) — 05-AI-COACH.md §4.
 *
 * Tools are how the model gets real numbers. Each `execute` calls into a small
 * injected `CoachDataSource` (defined here; the human wires the real impl over
 * `packages/health-core` metrics + the `HealthProvider` fetchers). Tools:
 *
 *  - Return the standard grounding envelope `{ value, unit, asOf, source }` so
 *    the model can cite value + freshness + provenance.
 *  - FAIL SOFT: when a metric is unavailable they return `{ available:false,
 *    reason }` instead of throwing, so the coach can honestly say "I don't have
 *    your HRV yet" rather than erroring.
 *  - Carry NO user-id parameter. The data source is built per request and
 *    closes over the authenticated `userId` (see chat.ts). The model cannot
 *    pass, spoof, or override the user — per-user scoping is server-side only.
 *
 * Tool-input schemas are Zod (the same Zod used for the OpenAPI contract).
 * `date` defaults to "today" server-side inside the data source.
 */
import { tool } from "ai";
import type { ToolSet } from "ai";
import { z } from "zod";

// ── Grounding envelope ──────────────────────────────────────────────────────

/** Provenance of a grounded value. Mirrors 03-DATA-MODEL.md §3.3 `source`. */
export type GroundedSource = "fitbit" | "google" | "ksfit" | "derived" | "estimate";

/** The standard envelope every tool returns when a value is available. */
export interface Grounded<T> {
  value: T;
  unit: string;
  /** ISO date (YYYY-MM-DD) the value is "as of". */
  asOf: string;
  source: GroundedSource;
}

/** Returned when a metric can't be produced (not wired, not worn, gated). */
export interface Unavailable {
  available: false;
  reason: string;
}

/** Every tool result is either a grounded payload or a soft "unavailable". */
export type ToolResult<T> = (Grounded<T> & { available: true }) | Unavailable;

/** Helper: wrap a grounded value as an available result. */
export function grounded<T>(g: Grounded<T>): ToolResult<T> {
  return { available: true, ...g };
}

/** Helper: a soft failure the model can narrate. */
export function unavailable(reason: string): Unavailable {
  return { available: false, reason };
}

// ── Structured payloads (each value is itself grounded) ─────────────────────

export interface RecoveryPayload {
  /** 0–100, or null when HRV gating means no honest score. */
  score: Grounded<number | null>;
  /** Component z-scores for transparency; absent when not computable. */
  components?: {
    hrv: Grounded<number>;
    rhr: Grounded<number>;
    breathing: Grounded<number>;
    sleep: Grounded<number>;
  };
}

export interface SleepPayload {
  asleepMin: Grounded<number>;
  inBedMin: Grounded<number>;
  efficiency: Grounded<number>;
  performance?: Grounded<number>;
  needMin?: Grounded<number>;
  debtMin?: Grounded<number>;
  stages?: Grounded<{ deep: number; light: number; rem: number; wake: number }>;
}

export interface HrvTrendPayload {
  /** Most recent nightly RMSSD. */
  latest: Grounded<number>;
  /** EWMA baseline (ms). */
  baseline: Grounded<number>;
  /** Personal target band (baseline ± 0.75σ). */
  band: Grounded<{ low: number; high: number }>;
  trend: Grounded<"rising" | "flat" | "falling">;
}

export interface DailyActivityPayload {
  steps: Grounded<number>;
  distanceKm: Grounded<number>;
  activeMinutes: Grounded<number>;
  caloriesOut: Grounded<number>;
}

export interface ExerciseSummary {
  type: string;
  startTime: string; // ISO
  durationMin: number;
  avgHr?: number;
  calories?: number;
  source: "auto" | "manual";
}

// ── Injected data source (the human wires the real implementation) ──────────

/**
 * The seam the tools sit behind. Built per request, scoped to the authenticated
 * user — there is NO user-id argument anywhere because identity comes from the
 * session, never the model. Each method resolves `date` to "today" when omitted
 * and returns the fail-soft `ToolResult` shape.
 *
 * The real implementation reads `packages/health-core` metrics + the
 * `HealthProvider` fetchers (Phase 3). Until HRV is wired, recovery/HRV tools
 * legitimately return `{ available:false }`.
 */
export interface CoachDataSource {
  getRecovery(date?: string): Promise<ToolResult<RecoveryPayload>>;
  getStrain(date?: string): Promise<ToolResult<number>>;
  getSleep(date?: string): Promise<ToolResult<SleepPayload>>;
  getHrvTrend(days?: number): Promise<ToolResult<HrvTrendPayload>>;
  getStress(date?: string): Promise<ToolResult<number>>;
  getFitnessAge(): Promise<ToolResult<number>>;
  getDailyActivity(date?: string): Promise<ToolResult<DailyActivityPayload>>;
  getExercises(date?: string): Promise<ToolResult<ExerciseSummary[]>>;
}

// ── Tool input schemas (Zod) ────────────────────────────────────────────────

const dateInput = z.object({
  /** Target day (YYYY-MM-DD). Defaults to today, resolved server-side. */
  date: z.string().date().optional(),
});

const daysInput = z.object({
  /** Look-back window in days. Defaults applied server-side. */
  days: z.number().int().positive().max(90).optional(),
});

const noInput = z.object({});

/**
 * Build the AI SDK tool set bound to a per-request, per-user data source.
 *
 * Because each `execute` closes over `ds` (which is scoped to the authenticated
 * user) and exposes no user-id input, the model can only ever read the current
 * session's data.
 */
export function buildCoachTools(ds: CoachDataSource): ToolSet {
  return {
    getRecovery: tool({
      description:
        "Stride's Recovery estimate (0–100) for a day, with component z-scores " +
        "(HRV, resting HR, breathing, sleep). Gated on HRV: returns available:false " +
        "when HRV isn't wired or there aren't enough nights yet. Stride's own estimate, not WHOOP.",
      inputSchema: dateInput,
      execute: ({ date }) => ds.getRecovery(date),
    }),

    getStrain: tool({
      description:
        "Day Strain (0–21), a cardiovascular load score from TRIMP, log-mapped and " +
        "self-calibrated to THIS user's own 90-day range. Not comparable across people.",
      inputSchema: dateInput,
      execute: ({ date }) => ds.getStrain(date),
    }),

    getSleep: tool({
      description:
        "Sleep for a night: asleep/in-bed minutes, efficiency, stages, plus Stride's " +
        "Sleep Need / Sleep Performance and sleep debt. Stages and efficiency are direct device data.",
      inputSchema: dateInput,
      execute: ({ date }) => ds.getSleep(date),
    }),

    getHrvTrend: tool({
      description:
        "Nightly HRV (RMSSD) vs the user's personal EWMA baseline band (±0.75σ) and the trend " +
        "(rising/flat/falling). The band IS the target; there is no fabricated ideal HRV number.",
      inputSchema: daysInput,
      execute: ({ days }) => ds.getHrvTrend(days),
    }),

    getStress: tool({
      description:
        "Stress as an HR-BASED ESTIMATE of physiological arousal (0–100) for a day, exercise " +
        "excluded. NOT an emotion meter and NOT a clinical stress score — present it modestly.",
      inputSchema: dateInput,
      execute: ({ date }) => ds.getStress(date),
    }),

    getFitnessAge: tool({
      description:
        "Cardiorespiratory Fitness Age (VO2max vs age/sex norms). NOT biological or epigenetic age. " +
        "Returns available:false when there's no VO2max input.",
      inputSchema: noInput,
      execute: () => ds.getFitnessAge(),
    }),

    getDailyActivity: tool({
      description:
        "Daily activity for a day: steps, distance (km), active minutes, calories out. Direct device data.",
      inputSchema: dateInput,
      execute: ({ date }) => ds.getDailyActivity(date),
    }),

    getExercises: tool({
      description:
        "Workouts logged on a day (auto-detected and manual): type, start, duration, average HR, calories.",
      inputSchema: dateInput,
      execute: ({ date }) => ds.getExercises(date),
    }),
  };
}
