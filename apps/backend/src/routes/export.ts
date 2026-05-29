/**
 * CSV export routes (ported from apps/web/src/app/api/export/*).
 * Same payloads, now served by the backend from a context-resolved session.
 */
import { Hono, type Context } from "hono";
import { toCsv } from "@stride/ksfit-client/csv";
import { fmtDateTime, parsePointList, CONSUME_SCALE } from "@stride/ksfit-client/data";
import { requireSession } from "../lib/ksfit/session.ts";
import { fetchAll, fetchRecordPoints } from "../lib/ksfit/fetchers.ts";

type Env = { Variables: { requestId: string } };
export const exportRoutes = new Hono<Env>();

function csv(c: Context, filename: string, body: string) {
  c.header("Content-Type", "text/csv; charset=utf-8");
  c.header("Content-Disposition", `attachment; filename="${filename}"`);
  c.header("Cache-Control", "no-store");
  return c.body(body);
}

exportRoutes.get("/sessions.csv", async (c) => {
  const session = await requireSession(c);
  const { sessions } = await fetchAll(session);
  const headers = [
    "run_id", "start_time_utc", "start_time_iso", "duration_sec", "distance_m",
    "distance_km", "steps", "kcal", "avg_speed_kmh", "pace_sec_per_km",
    "avg_heart_rate", "model", "device_id", "course", "apple_watch",
  ];
  const rows = sessions.map((s) => [
    s.runId,
    fmtDateTime(s.startTime, { dateStyle: "medium", timeStyle: "medium" }, "en-GB"),
    s.startTime.toISOString(),
    s.durationSec,
    s.distanceM,
    (s.distanceM / 1000).toFixed(3),
    s.steps,
    s.kcal.toFixed(2),
    s.avgSpeedKmh.toFixed(2),
    s.paceSecPerKm,
    s.heartAvg || "",
    s.model,
    s.deviceId,
    s.courseName,
    s.isAppleWatch ? "yes" : "no",
  ]);
  return csv(c, "stride-sessions.csv", toCsv(headers, rows));
});

exportRoutes.get("/weight.csv", async (c) => {
  const session = await requireSession(c);
  const { weights } = await fetchAll(session);
  const headers = [
    "time_utc", "time_iso", "weight_kg", "bmi", "body_fat_pct", "water_rate_pct",
    "bmr", "visceral_fat", "muscle_mass", "body_age",
  ];
  const rows = weights.map((w) => [
    fmtDateTime(w.at, { dateStyle: "medium", timeStyle: "short" }, "en-GB"),
    w.at.toISOString(),
    w.weight || "",
    w.bmi || "",
    w.fat || "",
    w.waterRate || "",
    w.bmr || "",
    w.visceralFat || "",
    w.muscleMass || "",
    w.bodyAge || "",
  ]);
  return csv(c, "stride-weight.csv", toCsv(headers, rows));
});

exportRoutes.get("/points/:runId", async (c) => {
  const runId = c.req.param("runId");
  const session = await requireSession(c);
  const resp = await fetchRecordPoints(session, runId).catch(() => null);
  const points = parsePointList(resp);
  const headers = ["elapsed_sec", "speed_kmh", "distance_m", "steps", "kcal", "cadence_spm"];
  const rows = points.map((p) => [
    p.t,
    p.speedKmh.toFixed(1),
    Math.round(p.distanceM),
    p.steps,
    (p.kcal / CONSUME_SCALE).toFixed(3),
    p.cadence,
  ]);
  return csv(c, `stride-session-${runId}.csv`, toCsv(headers, rows));
});
