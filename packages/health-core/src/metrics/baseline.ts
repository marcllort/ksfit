/**
 * Foundational baseline math shared by every WHOOP-style metric.
 *
 * Everything here is pure, deterministic, and network-free (per the data-model
 * doc §4: the metric engine is plain TS so it's unit-testable and the AI coach
 * never recomputes a health value). The two primitives the rest of the metrics
 * lean on are:
 *
 *   - EWMA  — exponentially weighted moving average, `s_t = λ·x_t + (1−λ)·s_{t−1}`
 *             with a span convention "EWMA over N points ⇒ λ = 2/(N+1)".
 *   - z-score against the EWMA mean and EWMA standard deviation of the same
 *             series, clamped to [−3, +3] (04-FEATURES §"Foundational conventions").
 *
 * Several signals (HRV/RMSSD especially) are right-skewed, so callers can opt
 * into an `ln` transform: the EWMA runs in log space and the band/baseline is
 * exponentiated back. See `hrv.ts` for the canonical use.
 */

/** Span → smoothing factor λ. "EWMA over N points" ⇒ λ = 2/(N+1). */
export function spanToLambda(span: number): number {
  if (!(span > 0)) {
    throw new RangeError(`EWMA span must be > 0, got ${span}`);
  }
  return 2 / (span + 1);
}

/** Clamp a value into [lo, hi]. */
export function clamp(x: number, lo: number, hi: number): number {
  return x < lo ? lo : x > hi ? hi : x;
}

/**
 * Standard-normal CDF Φ(x), via the Abramowitz & Stegun 7.1.26 erf
 * approximation. Deterministic, |error| < 1.5e-7 — ample for a 0–100 score.
 * Used by Recovery to map a weighted z-blend into (0, 1).
 */
export function standardNormalCdf(x: number): number {
  // erf via A&S 7.1.26
  const sign = x < 0 ? -1 : 1;
  const z = Math.abs(x) / Math.SQRT2;
  const t = 1 / (1 + 0.3275911 * z);
  const y =
    1 -
    ((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) *
      t +
      0.254829592) *
      t *
      Math.exp(-z * z);
  const erf = sign * y;
  return 0.5 * (1 + erf);
}

/** Result of streaming a series through an EWMA mean+variance tracker. */
export interface EwmaState {
  /** EWMA mean (in transformed space when `ln` was used). */
  mean: number;
  /** EWMA variance (transformed space). */
  variance: number;
  /** EWMA standard deviation = sqrt(variance). */
  sd: number;
  /** Count of usable (finite) observations folded in. */
  count: number;
}

export interface EwmaOptions {
  /** "EWMA over N points"; converted to λ = 2/(N+1). */
  span: number;
  /** Run the EWMA on ln(x) instead of x (for right-skewed signals). */
  ln?: boolean;
}

/**
 * Fold a series (oldest → newest) into an EWMA mean and an EWMA variance.
 *
 * The variance uses West's incremental EWMA-variance recurrence so it tracks
 * dispersion with the same memory as the mean:
 *   diff       = x_t − mean_{t−1}
 *   incr       = λ · diff
 *   mean_t     = mean_{t−1} + incr
 *   variance_t = (1 − λ) · (variance_{t−1} + diff · incr)
 *
 * Non-finite samples (NaN/Infinity) are skipped, as are non-positive values
 * when `ln` is requested (ln is undefined there). The first usable sample
 * seeds the mean with zero variance.
 */
export function ewma(series: readonly number[], opts: EwmaOptions): EwmaState {
  const lambda = spanToLambda(opts.span);
  let mean = 0;
  let variance = 0;
  let count = 0;

  for (const raw of series) {
    if (!Number.isFinite(raw)) continue;
    let x = raw;
    if (opts.ln) {
      if (raw <= 0) continue;
      x = Math.log(raw);
    }
    if (count === 0) {
      mean = x;
      variance = 0;
    } else {
      const diff = x - mean;
      const incr = lambda * diff;
      mean += incr;
      variance = (1 - lambda) * (variance + diff * incr);
    }
    count += 1;
  }

  return { mean, variance, sd: Math.sqrt(variance), count };
}

/**
 * z-score of `latest` against an already-computed EWMA state, clamped to
 * [−3, +3] per the doc. When the EWMA sd is ~0 (degenerate / too few points)
 * we return 0 — "at baseline" — rather than dividing by zero.
 *
 * `ln: true` z-scores ln(latest) against an ln-space EWMA state, matching how
 * the state was built.
 */
export function zScore(
  latest: number,
  state: EwmaState,
  opts: { ln?: boolean } = {},
): number {
  if (!Number.isFinite(latest)) return 0;
  let x = latest;
  if (opts.ln) {
    if (latest <= 0) return 0;
    x = Math.log(latest);
  }
  if (!(state.sd > 1e-9)) return 0;
  const z = (x - state.mean) / state.sd;
  return clamp(z, -3, 3);
}

/** percentile (linear interpolation) of a numeric series; p in [0,1]. */
export function percentile(series: readonly number[], p: number): number {
  const xs = series.filter((v) => Number.isFinite(v)).slice().sort((a, b) => a - b);
  if (xs.length === 0) return NaN;
  if (xs.length === 1) return xs[0]!;
  const rank = clamp(p, 0, 1) * (xs.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return xs[lo]!;
  const frac = rank - lo;
  return xs[lo]! * (1 - frac) + xs[hi]! * frac;
}
