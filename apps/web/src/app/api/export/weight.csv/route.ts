import { fetchAll } from "@/lib/fetchers";
import { toCsv, csvResponse } from "@stride/ksfit-client/csv";
import { fmtDateTime } from "@stride/ksfit-client/data";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Weight log (with body-composition fields) as CSV. */
export async function GET() {
  const { weights } = await fetchAll();
  const headers = [
    "time_utc",
    "time_iso",
    "weight_kg",
    "bmi",
    "body_fat_pct",
    "water_rate_pct",
    "bmr",
    "visceral_fat",
    "muscle_mass",
    "body_age",
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
  return csvResponse("stride-weight.csv", toCsv(headers, rows));
}
