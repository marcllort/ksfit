/**
 * /v1/metrics/* — derived WHOOP-style metrics + /v1/exercises + /v1/profile.
 *
 * Each route resolves the request's FitbitProvider (cookie token store), wraps
 * it in MetricsService, and returns the computed metric. Provider-not-connected
 * and metric-gated states map to the contract's 401/422 codes so the frontend
 * renders an honest "connect Fitbit" / "needs HRV" state instead of a fake number.
 */
import { Hono, type Context } from "hono";
import { NotConnectedError, FitbitRateLimitError } from "@stride/health-core";
import { fitbitForRequest } from "../lib/fitbit/store.ts";
import { MetricsService } from "../lib/metrics/service.ts";
import { apiError } from "../lib/errors.ts";

type Env = { Variables: { requestId: string } };
export const metricsRoutes = new Hono<Env>();

/** Today's UTC date if no ?date= given. */
function dateParam(c: Context): string {
  return c.req.query("date") ?? new Date().toISOString().slice(0, 10);
}

/** Run a metric producer with the request's provider, mapping provider errors. */
async function withMetrics<T>(
  c: Context<Env>,
  fn: (m: MetricsService) => Promise<T>,
): Promise<Response> {
  try {
    const result = await fn(new MetricsService(await fitbitForRequest(c)));
    return c.json(result as object);
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return apiError(c, "provider_not_connected", "Connect Fitbit to see this metric.");
    }
    if (e instanceof FitbitRateLimitError) {
      return apiError(c, "rate_limited", "Upstream rate limit — try again shortly.");
    }
    console.error(`[${c.get("requestId")}] metrics`, e);
    return apiError(c, "provider_error", "Couldn't compute this metric.");
  }
}

metricsRoutes.get("/recovery", (c) => withMetrics(c, (m) => m.recovery(dateParam(c))));
metricsRoutes.get("/strain", (c) => withMetrics(c, (m) => m.strain(dateParam(c))));
metricsRoutes.get("/sleep", (c) => withMetrics(c, (m) => m.sleep(dateParam(c))));
metricsRoutes.get("/stress", (c) => withMetrics(c, (m) => m.stress(dateParam(c))));
metricsRoutes.get("/fitness-age", (c) => withMetrics(c, (m) => m.fitnessAge(dateParam(c))));
metricsRoutes.get("/hrv", (c) => {
  const days = Number(c.req.query("days") ?? "30");
  return withMetrics(c, (m) => m.hrvTrend(dateParam(c), days));
});
metricsRoutes.get("/daily-activity", (c) =>
  withMetrics(c, (m) => m.dailyActivity(dateParam(c))),
);
