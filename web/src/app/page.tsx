import Link from "next/link";
import {
  ArrowUpRight,
  Flame,
  Footprints,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { Card, CardHeader, Pill, Empty } from "@/components/ui";
import { RefreshButton } from "@/components/refresh-button";
import { Heatmap } from "@/components/charts/heatmap";
import { BarTrend, AreaTrend } from "@/components/charts/trend";
import { DayPanel } from "@/components/day-panel";
import { fetchAll } from "@/lib/fetchers";
import { getSetting } from "@/lib/settings/server";
import {
  currentStreak,
  dayKey,
  fmtDateTime,
  fmtDurationCompact,
  fmtKcal,
  fmtKm,
  fmtPace,
  fmtSteps,
  groupByDay,
  lastNDays,
  sumStats,
} from "@/lib/data";

export const dynamic = "force-dynamic";

const MS_DAY = 86_400_000;

function startOfWeekUtc(d: Date): Date {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = (utc.getUTCDay() + 6) % 7;
  return new Date(utc.getTime() - dow * MS_DAY);
}

export default async function DashboardPage() {
  const [{ user, sessions, weights }, STEPS_GOAL] = await Promise.all([
    fetchAll(),
    getSetting("stepsGoal"),
  ]);

  const now = new Date();
  const todayKey = dayKey(now);
  const weekStart = startOfWeekUtc(now);
  const buckets = groupByDay(sessions);

  const today = buckets.get(todayKey);
  const todaySteps = today?.steps ?? 0;

  const last30 = sumStats(sessions, new Date(now.getTime() - 30 * MS_DAY));
  const allTime = sumStats(sessions);
  const streak = currentStreak(buckets, STEPS_GOAL, now);

  const heatmapDays = lastNDays(sessions, 26 * 7, now);
  const heatCells = heatmapDays.map((d) => ({
    date: d.date,
    value: Math.round(d.durationSec / 60),
  }));

  const weekBars: { label: string; value: number }[] = [];
  for (let i = 11; i >= 0; i--) {
    const ws = new Date(weekStart.getTime() - i * 7 * MS_DAY);
    let km = 0;
    for (let d = 0; d < 7; d++) {
      const key = new Date(ws.getTime() + d * MS_DAY).toISOString().slice(0, 10);
      km += (buckets.get(key)?.distanceM ?? 0) / 1000;
    }
    weekBars.push({
      label: ws.toISOString().slice(5, 10),
      value: Number(km.toFixed(2)),
    });
  }

  const last7 = lastNDays(sessions, 7, now).map((d) => ({
    label: d.date.slice(5),
    value: Number((d.distanceM / 1000).toFixed(2)),
  }));

  const recent = sessions.slice(0, 6);
  const latestWeight = weights[weights.length - 1];
  const firstWeight = weights[0];
  const weightDelta =
    latestWeight && firstWeight ? latestWeight.weight - firstWeight.weight : 0;

  return (
    <Shell userName={user.nickname || "Athlete"} userAvatar={user.avatar}>
      {/* Greeting */}
      <section className="mb-6 animate-rise">
        <div className="flex flex-col items-start justify-between gap-3 sm:flex-row sm:items-end">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
              {greet(now)}, {user.nickname}
            </p>
            <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
              {todaySteps > 0
                ? todaySteps >= STEPS_GOAL
                  ? "Goal hit. Nice work."
                  : "You're on the move."
                : "Time to lace up."}
            </h1>
            <p className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-ink-3">
              <span>
                {allTime.count.toLocaleString()} sessions ·{" "}
                <span className="tnum">{fmtKm(allTime.distanceM, 1)} km</span>{" "}
                lifetime
              </span>
              {streak > 0 ? (
                <span
                  className="inline-flex items-center gap-1 rounded-full bg-[color:var(--positive)]/10 px-2 py-0.5 text-xs font-medium text-[color:var(--positive)] tnum"
                  title={`${streak} consecutive day${streak === 1 ? "" : "s"} hitting ${fmtSteps(STEPS_GOAL)} steps`}
                >
                  <Flame className="h-3 w-3" />
                  {streak}-day streak
                </span>
              ) : null}
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <RefreshButton />
            <Link href="/sessions">
              <Pill tone="default" className="cursor-pointer hover:bg-paper-3">
                View all sessions <ArrowUpRight className="ml-1 h-3 w-3" />
              </Pill>
            </Link>
            <Link href="/calendar">
              <Pill tone="default" className="cursor-pointer hover:bg-paper-3">
                Open calendar <ArrowUpRight className="ml-1 h-3 w-3" />
              </Pill>
            </Link>
          </div>
        </div>
      </section>

      {/* Today headline panel */}
      <section className="mb-6 animate-rise" style={{ animationDelay: "60ms" }}>
        <DayPanel
          date={todayKey}
          sessions={sessions}
          stepsGoal={STEPS_GOAL}
          now={now}
        />
      </section>

      {/* Charts row */}
      <section className="mb-6 grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader
            title="Last 7 days"
            hint="Distance per day"
            action={<Pill tone="muted">km</Pill>}
          />
          <div className="px-2 pb-3">
            <AreaTrend data={last7} height={150} unit="km" />
          </div>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader
            title="Weekly volume"
            hint="Distance, last 12 weeks"
            action={<Pill tone="muted">km / wk</Pill>}
          />
          <div className="px-2 pb-3">
            <BarTrend data={weekBars} height={180} unit="km" />
          </div>
        </Card>
      </section>

      {/* Heatmap */}
      <section className="mb-6">
        <Card>
          <CardHeader
            title="Activity heatmap"
            hint="Minutes of movement, last 26 weeks · click a day for detail"
            action={
              <div className="text-right">
                <div className="tnum text-xl font-semibold text-ink-0">
                  {last30.activeDays}
                </div>
                <div className="text-[11px] uppercase tracking-wider text-ink-4">
                  active days · 30d
                </div>
              </div>
            }
          />
          <div className="px-5 pb-5 pt-2">
            {heatCells.some((c) => c.value > 0) ? (
              <Heatmap cells={heatCells} unit="min" />
            ) : (
              <Empty>No sessions in this window.</Empty>
            )}
          </div>
        </Card>
      </section>

      {/* Recent + weight */}
      <section className="grid gap-4 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader
            title="Recent sessions"
            hint={`${sessions.length.toLocaleString()} total`}
            action={
              <Link
                href="/sessions"
                className="text-xs font-medium text-ink-2 hover:text-ink-0"
              >
                See all →
              </Link>
            }
          />
          <div className="divide-y divide-line">
            {recent.length === 0 ? (
              <div className="p-5">
                <Empty>No sessions yet.</Empty>
              </div>
            ) : (
              recent.map((s) => (
                <Link
                  key={s.runId}
                  href={`/sessions/${s.runId}`}
                  className="group flex items-center justify-between gap-3 px-5 py-3.5 transition-colors hover:bg-paper-2"
                >
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-3 transition-colors group-hover:bg-accent group-hover:text-accent-fg">
                      <Footprints className="h-4 w-4" />
                    </div>
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium text-ink-1">
                        {fmtDateTime(s.startTime, {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        }, "en-US")}
                      </div>
                      <div className="truncate text-xs text-ink-3 tnum">
                        {s.model}
                        {s.paceSecPerKm > 0
                          ? ` · pace ${fmtPace(s.paceSecPerKm)}/km`
                          : ""}
                        {s.courseName ? ` · ${s.courseName}` : ""}
                      </div>
                    </div>
                  </div>
                  <div className="grid grid-cols-3 gap-4 text-right tnum text-sm sm:gap-6">
                    <div>
                      <div className="text-ink-0 font-semibold">
                        {fmtKm(s.distanceM, 2)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-4">
                        km
                      </div>
                    </div>
                    <div>
                      <div className="text-ink-0 font-semibold">
                        {fmtDurationCompact(s.durationSec)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-4">
                        time
                      </div>
                    </div>
                    <div className="hidden sm:block">
                      <div className="text-ink-0 font-semibold">
                        {fmtKcal(s.kcal)}
                      </div>
                      <div className="text-[10px] uppercase tracking-wider text-ink-4">
                        kcal
                      </div>
                    </div>
                  </div>
                </Link>
              ))
            )}
          </div>
        </Card>

        <Card className="lg:col-span-1">
          <CardHeader
            title="Weight"
            hint={
              latestWeight
                ? `Latest: ${latestWeight.weight.toFixed(1)} kg · BMI ${latestWeight.bmi.toFixed(1)}`
                : "No weight entries yet"
            }
            action={
              latestWeight &&
              firstWeight &&
              firstWeight.id !== latestWeight.id ? (
                <Pill
                  tone={
                    weightDelta < 0 ? "good" : weightDelta > 0 ? "warn" : "muted"
                  }
                >
                  {weightDelta < 0 ? (
                    <TrendingDown className="mr-1 h-3 w-3" />
                  ) : (
                    <TrendingUp className="mr-1 h-3 w-3" />
                  )}
                  {weightDelta > 0 ? "+" : ""}
                  {weightDelta.toFixed(1)} kg
                </Pill>
              ) : null
            }
          />
          <div className="p-5 pt-1">
            {weights.length > 0 ? (
              <AreaTrend
                data={weights.map((w) => ({
                  label: w.at.toISOString().slice(5, 10),
                  value: Number(w.weight.toFixed(1)),
                }))}
                height={180}
                unit="kg"
              />
            ) : (
              <Empty>No weight log yet.</Empty>
            )}
            <Link
              href="/weight"
              className="mt-3 inline-flex items-center text-xs font-medium text-ink-2 hover:text-ink-0"
            >
              Full weight history →
            </Link>
          </div>
        </Card>
      </section>
    </Shell>
  );
}

function greet(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
