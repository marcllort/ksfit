import { Shell } from "@/components/shell";
import { Card, CardHeader, Metric, Empty } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import {
  fitbitConnected,
  fitbitDailyActivity,
  fitbitHeartRateForDay,
  fitbitSleep,
} from "@/lib/health/fetchers";
import { metricExercises } from "@/lib/health/metrics-fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { Activity, HeartPulse, Moon, Footprints, Dumbbell, ChevronRight } from "lucide-react";
import Link from "next/link";

function fmtDuration(sec: number): string {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export const dynamic = "force-dynamic";
export const metadata = { title: "Fitbit · Stride" };

function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = min % 60;
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

/** Last N UTC day keys, newest first. */
function recentDays(n: number, today: Date): string[] {
  const out: string[] = [];
  const base = Date.UTC(
    today.getUTCFullYear(),
    today.getUTCMonth(),
    today.getUTCDate(),
  );
  for (let i = 0; i < n; i++) {
    out.push(new Date(base - i * 86_400_000).toISOString().slice(0, 10));
  }
  return out;
}

export default async function FitbitPage() {
  const { user } = await fetchAll();
  const connected = await fitbitConnected();

  if (!connected) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Fitbit
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Health data
          </h1>
        </header>
        <Card>
          <div className="p-8">
            <Empty>
              {fitbitConfigured ? (
                <>
                  Fitbit isn&apos;t connected yet.{" "}
                  <Link href="/settings" className="text-ink-1 underline">
                    Connect it in Settings
                  </Link>{" "}
                  to see heart rate, sleep, and activity here.
                </>
              ) : (
                <>Fitbit isn&apos;t configured. See docs/FITBIT.md.</>
              )}
            </Empty>
          </div>
        </Card>
      </Shell>
    );
  }

  // Pull a handful of recent days. Each fetcher is cached and fails soft.
  const now = new Date();
  const days = recentDays(7, now);
  const todayKey = days[0]!;

  const [hr, sleep, activity, exercises] = await Promise.all([
    fitbitHeartRateForDay(todayKey, false),
    fitbitSleep(todayKey),
    fitbitDailyActivity(todayKey),
    metricExercises(todayKey),
  ]);

  // A small week table for activity + sleep.
  const week = await Promise.all(
    days.map(async (d) => ({
      date: d,
      activity: await fitbitDailyActivity(d),
      sleep: await fitbitSleep(d),
    })),
  );

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
          Fitbit
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
          Health data
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          Today ({todayKey}) · synced from your Fitbit account
        </p>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-0">
          <Metric
            label="Resting HR"
            value={hr?.restingHr ?? "—"}
            unit={hr?.restingHr ? "bpm" : undefined}
            icon={<HeartPulse className="h-4 w-4" />}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Steps"
            value={activity ? activity.steps.toLocaleString() : "—"}
            icon={<Footprints className="h-4 w-4" />}
            sub={activity ? `${activity.distanceKm.toFixed(2)} km` : undefined}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Active min"
            value={activity ? activity.activeMinutes : "—"}
            icon={<Activity className="h-4 w-4" />}
            sub={activity ? `${activity.caloriesOut.toLocaleString()} kcal out` : undefined}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Sleep"
            value={sleep ? fmtMin(sleep.asleepMin) : "—"}
            icon={<Moon className="h-4 w-4" />}
            sub={sleep ? `${sleep.efficiency}% efficiency` : undefined}
          />
        </Card>
      </section>

      {hr && hr.zones.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title="Heart-rate zones" hint={`Today · ${todayKey}`} />
          <div className="grid grid-cols-2 gap-px overflow-hidden bg-line sm:grid-cols-4">
            {hr.zones.map((z) => (
              <div key={z.name} className="bg-paper-1 p-4">
                <div className="text-xs uppercase tracking-[0.12em] text-ink-3">
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
        </Card>
      ) : null}

      {exercises.length > 0 ? (
        <Card className="mb-6">
          <CardHeader
            title="Exercises"
            hint={`Detected today · ${todayKey}`}
          />
          <div className="divide-y divide-line">
            {exercises.map((e) => (
              <Link
                key={e.id}
                href={`/exercises/${e.id}`}
                className="flex items-center gap-3 px-5 py-3.5 transition-colors hover:bg-paper-2"
              >
                <Dumbbell className="h-4 w-4 text-ink-4" />
                <div className="flex-1">
                  <div className="text-sm font-medium text-ink-1">{e.type}</div>
                  <div className="text-xs text-ink-4 tnum">
                    {fmtDuration(e.durationSec)}
                    {e.avgHr != null ? ` · ${e.avgHr} bpm avg` : ""}
                    {e.source === "auto" ? " · auto" : ""}
                  </div>
                </div>
                <ChevronRight className="h-4 w-4 text-ink-4" />
              </Link>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Last 7 days" hint="Activity & sleep" />
        <div className="divide-y divide-line">
          {week.map((d) => (
            <div
              key={d.date}
              className="grid grid-cols-[1fr_auto_auto_auto] items-center gap-3 px-5 py-3 text-sm"
            >
              <div className="text-ink-2 tnum">{d.date}</div>
              <div className="tnum text-ink-1">
                {d.activity ? `${d.activity.steps.toLocaleString()} steps` : "—"}
              </div>
              <div className="tnum text-ink-3 hidden sm:block">
                {d.activity ? `${d.activity.distanceKm.toFixed(1)} km` : ""}
              </div>
              <div className="tnum text-ink-3">
                {d.sleep ? fmtMin(d.sleep.asleepMin) : "—"}
              </div>
            </div>
          ))}
        </div>
      </Card>
    </Shell>
  );
}
