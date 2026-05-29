/**
 * HRV baseline + personal target band (04-FEATURES §4).
 *
 * RMSSD is right-skewed, so we work in log space:
 *   x_t      = ln(rmssd_t)
 *   μ_t      = EWMA(x_t, span 30)            // λ = 2/31
 *   σ_t      = sqrt(EWMA((x_t − μ_t)^2, 30))
 *   baseline = exp(μ_t)
 *   bandLow  = exp(μ_t − 0.75·σ_t)
 *   bandHigh = exp(μ_t + 0.75·σ_t)
 *   status   = below | within | above        // vs the latest night
 *
 * The band *is* the target — we deliberately never emit a single fabricated
 * "ideal HRV" number. Trend (rising/flat/falling baseline) is the real signal.
 */
import type { HrvReading } from "../types";
import { ewma, type EwmaState } from "./baseline";

/** Nights of history the EWMA baseline targets. */
export const HRV_BASELINE_SPAN = 30;
/** Band half-width in σ (04-FEATURES §4). */
export const HRV_BAND_SIGMA = 0.75;
/**
 * Minimum nights of HRV before the band/baseline is trustworthy. Mirrors the
 * Recovery gate (04-FEATURES §1): fewer than ~14 nights ⇒ not honest yet.
 */
export const HRV_MIN_NIGHTS = 14;
/** Trailing nights compared against the older baseline to call a trend. */
const HRV_TREND_WINDOW = 7;
/** ln-ms baseline delta below which the trend is "flat". */
const HRV_TREND_FLAT_EPS = 0.02;

export type HrvStatus = "below" | "within" | "above";
export type HrvTrend = "rising" | "flat" | "falling";

export interface HrvBaseline {
  /** exp(μ): the personal baseline RMSSD in ms (null until enough nights). */
  baseline: number | null;
  /** exp(μ − 0.75σ): bottom of the target band, ms. */
  low: number | null;
  /** exp(μ + 0.75σ): top of the target band, ms. */
  high: number | null;
  /** Most recent night's RMSSD (ms), or null if the series is empty. */
  latest: number | null;
  /** Where the latest night sits relative to its band. */
  status: HrvStatus | null;
  /** Direction of the baseline itself over the trailing week. */
  trend: HrvTrend;
  /** EWMA mean of ln(rmssd) — the rolling state persisted in daily_scores. */
  lnEwma: number | null;
  /** Usable nights folded in. */
  nights: number;
  /** False until `nights >= HRV_MIN_NIGHTS`; gates Recovery. */
  sufficient: boolean;
}

/** Order a readings array oldest → newest by date. */
function sortByDate(series: readonly HrvReading[]): HrvReading[] {
  return series.slice().sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
}

/**
 * Compute the HRV baseline + band from a series of nightly RMSSD readings.
 * `series` need not be sorted; we sort oldest → newest internally. Readings
 * with non-finite or non-positive rmssd are skipped (ln undefined).
 */
export function computeHrvBaseline(series: readonly HrvReading[]): HrvBaseline {
  const sorted = sortByDate(series);
  const rmssd = sorted
    .map((r) => r.rmssd)
    .filter((v) => Number.isFinite(v) && v > 0);

  const latest = rmssd.length > 0 ? rmssd[rmssd.length - 1]! : null;

  if (rmssd.length === 0) {
    return {
      baseline: null,
      low: null,
      high: null,
      latest: null,
      status: null,
      trend: "flat",
      lnEwma: null,
      nights: 0,
      sufficient: false,
    };
  }

  const state: EwmaState = ewma(rmssd, { span: HRV_BASELINE_SPAN, ln: true });
  const baseline = Math.exp(state.mean);
  const low = Math.exp(state.mean - HRV_BAND_SIGMA * state.sd);
  const high = Math.exp(state.mean + HRV_BAND_SIGMA * state.sd);

  let status: HrvStatus | null = null;
  if (latest != null) {
    // Compare with a relative epsilon so a reading sitting exactly on the band
    // edge (e.g. a constant series, where σ≈0 collapses the band) is "within"
    // rather than tipped out by floating-point error.
    const eps = 1e-9 * Math.max(1, high);
    status =
      latest < low - eps ? "below" : latest > high + eps ? "above" : "within";
  }

  return {
    baseline,
    low,
    high,
    latest,
    status,
    trend: computeTrend(rmssd),
    lnEwma: state.mean,
    nights: state.count,
    sufficient: state.count >= HRV_MIN_NIGHTS,
  };
}

/**
 * Trend = compare the baseline computed from all nights against the baseline
 * computed excluding the trailing week. A rising recent baseline ⇒ "rising".
 * Falls back to "flat" until there's enough history to split.
 */
function computeTrend(rmssd: readonly number[]): HrvTrend {
  if (rmssd.length < HRV_TREND_WINDOW + 1) return "flat";
  const full = ewma(rmssd, { span: HRV_BASELINE_SPAN, ln: true }).mean;
  const past = ewma(rmssd.slice(0, rmssd.length - HRV_TREND_WINDOW), {
    span: HRV_BASELINE_SPAN,
    ln: true,
  }).mean;
  const delta = full - past;
  if (delta > HRV_TREND_FLAT_EPS) return "rising";
  if (delta < -HRV_TREND_FLAT_EPS) return "falling";
  return "flat";
}
