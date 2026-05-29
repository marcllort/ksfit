/**
 * /v1/coach/chat — the AI health coach (Vercel AI SDK, streamed).
 *
 * Builds a per-request CoachDataSource over the metrics service (identity =
 * the request's Fitbit provider; the client never supplies a user id), a
 * compact daily snapshot for the cached prompt prefix, and streams the model
 * response back. Falls back to a clear error if ANTHROPIC_API_KEY is unset.
 */
import { Hono } from "hono";
import { fitbitForRequest } from "../lib/fitbit/store.ts";
import { MetricsService } from "../lib/metrics/service.ts";
import { metricsDataSource } from "../lib/coach/datasource.ts";
import { streamCoach, buildSnapshotText, type DailySnapshotInput } from "../lib/coach/index.ts";
import { apiError } from "../lib/errors.ts";

type Env = { Variables: { requestId: string } };
export const coachRoutes = new Hono<Env>();

coachRoutes.post("/chat", async (c) => {
  if (!process.env.ANTHROPIC_API_KEY) {
    return apiError(c, "provider_unconfigured", "AI coach is not configured (set ANTHROPIC_API_KEY).");
  }
  let messages: unknown;
  try {
    ({ messages } = (await c.req.json()) as { messages?: unknown });
  } catch {
    return apiError(c, "invalid_request", "invalid JSON");
  }
  if (!Array.isArray(messages)) {
    return apiError(c, "invalid_request", "messages[] required");
  }

  const service = new MetricsService(fitbitForRequest(c));
  const dataSource = metricsDataSource(service);

  // Compact daily snapshot for the cache-marked prompt prefix (best-effort).
  let snapshot: DailySnapshotInput | undefined;
  try {
    const date = new Date().toISOString().slice(0, 10);
    const [recovery, sleep, strain] = await Promise.all([
      service.recovery(date).catch(() => null),
      service.sleep(date).catch(() => null),
      service.strain(date).catch(() => null),
    ]);
    snapshot = {
      date,
      recovery: { value: recovery?.score ?? null, unit: "score", asOf: date, source: "derived" },
      sleepPerformance: { value: sleep?.performance ?? null, unit: "%", asOf: date, source: "derived" },
      strain: {
        value: strain && "strain" in strain ? strain.strain : null,
        unit: "0-21",
        asOf: date,
        source: "derived",
      },
    };
    // buildSnapshotText is exercised here so a malformed snapshot fails fast.
    buildSnapshotText(snapshot);
  } catch {
    snapshot = undefined;
  }

  try {
    const result = await streamCoach({
      messages: messages as Parameters<typeof streamCoach>[0]["messages"],
      dataSource,
      snapshot,
    });
    return result.toUIMessageStreamResponse();
  } catch (e) {
    console.error(`[${c.get("requestId")}] coach`, e);
    return apiError(c, "provider_error", "The coach couldn't respond. Try again.");
  }
});
