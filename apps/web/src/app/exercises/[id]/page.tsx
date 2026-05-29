import { Shell } from "@/components/shell";
import { Card, CardHeader, Empty, Pill, Metric } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { metricExercises } from "@/lib/health/metrics-fetchers";
import type { Exercise } from "@stride/health-core";
import { Activity, HeartPulse, Clock, MapPin, Flame } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Exercise · Stride" };

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}
function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Recent UTC day keys, newest first. */
function recentDays(n: number): string[] {
  const out: string[] = [];
  const now = new Date();
  const base = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate());
  for (let i = 0; i < n; i++) {
    out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export default async function ExerciseDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const { user } = await fetchAll();

  let exercise: Exercise | null = null;
  if (await fitbitConnected()) {
    // Exercises are fetched per-day; scan the trailing 30 days to resolve the id.
    for (const day of recentDays(30)) {
      const list = await metricExercises(day);
      const found = list.find((e) => e.id === id);
      if (found) {
        exercise = found;
        break;
      }
    }
  }

  if (!exercise) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Exercise
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Exercise detail
          </h1>
        </header>
        <Card>
          <div className="p-8">
            <Empty>
              Couldn&apos;t find that exercise in the last 30 days.{" "}
              <Link href="/fitbit" className="text-ink-1 underline">
                Back to Fitbit
              </Link>
            </Empty>
          </div>
        </Card>
      </Shell>
    );
  }

  const ex = exercise;
  const zoneTotal = ex.hrZones?.reduce((s, z) => s + z.minutes, 0) || 0;

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Exercise
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            {ex.type}
          </h1>
          <p className="mt-1 text-sm text-ink-3 tnum">
            {ex.startTime.toISOString().replace("T", " ").slice(0, 16)} UTC
          </p>
        </div>
        <Pill tone={ex.source === "auto" ? "muted" : "default"}>
          {ex.source === "auto" ? "Auto-detected" : "Manual"}
        </Pill>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-0">
          <Metric
            label="Duration"
            value={fmtDuration(ex.durationSec)}
            icon={<Clock className="h-4 w-4" />}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Avg HR"
            value={ex.avgHr != null ? ex.avgHr : "—"}
            unit={ex.avgHr != null ? "bpm" : undefined}
            icon={<HeartPulse className="h-4 w-4" />}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Distance"
            value={ex.distanceM != null ? (ex.distanceM / 1000).toFixed(2) : "—"}
            unit={ex.distanceM != null ? "km" : undefined}
            icon={<MapPin className="h-4 w-4" />}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Calories"
            value={ex.calories != null ? ex.calories.toLocaleString() : "—"}
            unit={ex.calories != null ? "kcal" : undefined}
            icon={<Flame className="h-4 w-4" />}
          />
        </Card>
      </section>

      {ex.hrZones && ex.hrZones.length > 0 ? (
        <Card>
          <CardHeader title="Heart-rate zones" hint="Time in zone during this exercise" />
          <div className="px-5 pb-5">
            {zoneTotal > 0 ? (
              <div className="mb-4 flex h-4 overflow-hidden rounded-full">
                {ex.hrZones.map((z, i) => (
                  <div
                    key={z.name}
                    className={
                      [
                        "bg-paper-3",
                        "bg-[color:var(--positive)]",
                        "bg-[color:var(--accent)]",
                        "bg-[color:var(--bad)]",
                      ][i % 4]
                    }
                    style={{ width: `${(z.minutes / zoneTotal) * 100}%` }}
                    title={`${z.name} ${fmtMin(z.minutes)}`}
                  />
                ))}
              </div>
            ) : null}
            <div className="grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-4">
              {ex.hrZones.map((z) => (
                <div key={z.name} className="bg-paper-1 p-4">
                  <div className="flex items-center gap-1 text-xs uppercase tracking-[0.12em] text-ink-3">
                    <Activity className="h-3 w-3 text-ink-4" />
                    {z.name}
                  </div>
                  <div className="mt-1 tnum text-xl font-semibold text-ink-0">
                    {fmtMin(z.minutes)}
                  </div>
                  <div className="text-xs text-ink-4 tnum">
                    {z.min}–{z.max} bpm
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ) : (
        <Card>
          <div className="p-8">
            <Empty>No heart-rate zone breakdown for this exercise.</Empty>
          </div>
        </Card>
      )}
    </Shell>
  );
}
