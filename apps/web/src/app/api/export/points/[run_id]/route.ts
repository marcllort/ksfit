import { requireSession } from "@/lib/session";
import { fetchRecordPoints } from "@/lib/fetchers";
import { parsePointList, CONSUME_SCALE } from "@stride/ksfit-client/data";
import { toCsv, csvResponse } from "@stride/ksfit-client/csv";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Per-second telemetry for one session as CSV. */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ run_id: string }> },
) {
  const { run_id } = await params;
  const session = await requireSession();
  const resp = await fetchRecordPoints(session, run_id).catch(() => null);
  const points = parsePointList(resp);

  const headers = [
    "elapsed_sec",
    "speed_kmh",
    "distance_m",
    "steps",
    "kcal",
    "cadence_spm",
  ];
  const rows = points.map((p) => [
    p.t,
    p.speedKmh.toFixed(1),
    Math.round(p.distanceM),
    p.steps,
    (p.kcal / CONSUME_SCALE).toFixed(3),
    p.cadence,
  ]);
  return csvResponse(`stride-session-${run_id}.csv`, toCsv(headers, rows));
}
