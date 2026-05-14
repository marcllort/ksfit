import Link from "next/link";
import { ArrowLeft, Clock, Flame, Footprints, Route, Timer } from "lucide-react";
import { notFound } from "next/navigation";
import { Shell } from "@/components/shell";
import { Card, CardHeader, Metric, Pill, Empty } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import {
  dayKey,
  fmtDuration,
  fmtKcal,
  fmtKm,
  fmtPace,
  fmtSteps,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function DayPage({
  params,
}: {
  params: Promise<{ date: string }>;
}) {
  const { date } = await params;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) notFound();

  const { user, sessions } = await fetchAll();
  const today = sessions.filter((s) => dayKey(s.startTime) === date);

  const totals = today.reduce(
    (a, s) => ({
      d: a.d + s.distanceM,
      t: a.t + s.durationSec,
      n: a.n + 1,
      k: a.k + s.kcal,
      st: a.st + s.steps,
    }),
    { d: 0, t: 0, n: 0, k: 0, st: 0 },
  );

  const day = new Date(date + "T00:00:00Z");
  const prev = new Date(day.getTime() - 86_400_000).toISOString().slice(0, 10);
  const next = new Date(day.getTime() + 86_400_000).toISOString().slice(0, 10);

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <Link
        href="/calendar"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to calendar
      </Link>

      <header className="mb-8 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            {day.toLocaleDateString(undefined, { weekday: "long" })}
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            {day.toLocaleDateString(undefined, {
              month: "long",
              day: "numeric",
              year: "numeric",
            })}
          </h1>
        </div>
        <div className="flex gap-2">
          <Link href={`/day/${prev}`}>
            <Pill tone="default" className="cursor-pointer hover:bg-paper-3">
              ← {prev}
            </Pill>
          </Link>
          <Link href={`/day/${next}`}>
            <Pill tone="default" className="cursor-pointer hover:bg-paper-3">
              {next} →
            </Pill>
          </Link>
        </div>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-5">
        <Card className="p-0"><Metric label="Sessions" value={totals.n.toString()} /></Card>
        <Card className="p-0"><Metric label="Distance" value={fmtKm(totals.d)} unit="km" icon={<Route className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="Time" value={fmtDuration(totals.t)} icon={<Timer className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="Steps" value={fmtSteps(totals.st)} icon={<Footprints className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="kcal" value={fmtKcal(totals.k)} icon={<Flame className="h-4 w-4"/>} /></Card>
      </section>

      <Card>
        <CardHeader title="Sessions" hint={`${today.length} on this day`} />
        {today.length === 0 ? (
          <div className="p-5">
            <Empty>No activity on this day.</Empty>
          </div>
        ) : (
          <div className="divide-y divide-line">
            {today
              .slice()
              .sort((a, b) => a.startTime.getTime() - b.startTime.getTime())
              .map((s) => (
                <Link
                  key={s.runId}
                  href={`/sessions/${s.runId}`}
                  className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-5 py-4 transition-colors hover:bg-paper-2"
                >
                  <div className="grid h-10 w-10 place-items-center rounded-full bg-paper-2 text-ink-3 group-hover:bg-accent group-hover:text-accent-fg transition-colors">
                    <Footprints className="h-4 w-4" />
                  </div>
                  <div>
                    <div className="text-sm font-semibold text-ink-1 tnum">
                      {s.startTime.toLocaleTimeString(undefined, {
                        hour: "numeric",
                        minute: "2-digit",
                      })}
                      <span className="ml-2 text-ink-3 font-normal">
                        — {s.endTime.toLocaleTimeString(undefined, {
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </span>
                    </div>
                    <div className="mt-0.5 text-xs text-ink-3 tnum">
                      {s.model} · pace {fmtPace(s.paceSecPerKm)}/km · {s.avgSpeedKmh.toFixed(2)} km/h avg
                    </div>
                  </div>
                  <div className="flex items-center gap-5 tnum">
                    <div className="text-right">
                      <div className="text-base font-semibold text-ink-0">{fmtKm(s.distanceM)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-4">km</div>
                    </div>
                    <div className="text-right">
                      <div className="text-base font-semibold text-ink-0">{fmtDuration(s.durationSec)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-4">time</div>
                    </div>
                    <div className="hidden text-right sm:block">
                      <div className="text-base font-semibold text-ink-0">{fmtKcal(s.kcal)}</div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-4">kcal</div>
                    </div>
                  </div>
                </Link>
              ))}
          </div>
        )}
      </Card>
    </Shell>
  );
}
