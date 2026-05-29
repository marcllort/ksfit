/**
 * @stride/backend — the Stride API (Hono on Node).
 *
 * Sole custodian of third-party OAuth tokens; the web app and the future iOS
 * app are both just clients. Mounted under /api by Caddy on treadmill.home.
 * See docs/architecture/02-API-CONTRACT.md.
 */
import { serve } from "@hono/node-server";
import { Hono } from "hono";
import { requestId } from "./middleware/request-id.ts";
import { ApiError, apiError } from "./lib/errors.ts";
import { exportRoutes } from "./routes/export.ts";
import { authRoutes } from "./routes/auth.ts";
import { fitbitRoutes } from "./routes/fitbit.ts";
import { metricsRoutes } from "./routes/metrics.ts";
import { coachRoutes } from "./routes/coach.ts";
import { exerciseRoutes, profileRoutes } from "./routes/exercises.ts";

type Env = { Variables: { requestId: string } };

// strict:false so "/v1/profile" and "/v1/profile/" both match (trailing slash).
const app = new Hono<Env>({ strict: false });

app.use("*", requestId);

// Liveness probe — cheap, never touches upstreams.
app.get("/healthz", (c) => c.json({ status: "ok" }));

// v1 routes. See docs/architecture/02-API-CONTRACT.md.
app.route("/v1/auth", authRoutes);
app.route("/v1/fitbit", fitbitRoutes);
app.route("/v1/export", exportRoutes);
app.route("/v1/metrics", metricsRoutes);
app.route("/v1/exercises", exerciseRoutes);
app.route("/v1/profile", profileRoutes);
app.route("/v1/coach", coachRoutes);

// Centralized error envelope.
app.onError((err, c) => {
  if (err instanceof ApiError) {
    return apiError(c, err.code, err.message, err.details);
  }
  console.error(`[${c.get("requestId")}]`, err);
  return apiError(c, "internal", "Internal server error.");
});

app.notFound((c) => apiError(c, "not_found", "Not found."));

const port = Number(process.env.BACKEND_PORT ?? 3001);
serve({ fetch: app.fetch, port, hostname: "127.0.0.1" });
console.log(`[stride-backend] listening on http://127.0.0.1:${port}`);

export { app };
