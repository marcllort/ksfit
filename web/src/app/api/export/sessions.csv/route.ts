import { fetchAll } from "@/lib/fetchers";
import { toCsv, csvResponse } from "@/lib/csv";
import { fmtDateTime } from "@/lib/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every recorded session as CSV — the project's original motivation.
 * Times are emitted as UTC ISO plus a human-readable UTC string (matching
 * what the dashboard displays), so the file is unambiguous across timezones.
 */
export async function GET() {
  const { sessions } = await fetchAll();
  const headers = [
    "run_id",
    "start_time_utc",
    "start_time_iso",
    "duration_sec",
    "distance_m",
    "distance_km",
    "steps",
    "kcal",
    "avg_speed_kmh",
    "pace_sec_per_km",
    "avg_heart_rate",
    "model",
    "device_id",
    "course",
    "apple_watch",
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
  return csvResponse("stride-sessions.csv", toCsv(headers, rows));
}
