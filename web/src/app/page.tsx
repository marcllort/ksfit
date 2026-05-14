import Link from "next/link";
import {
  ArrowUpRight,
  Flame,
  Footprints,
  Route,
  Timer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { Card, CardHeader, Pill, Empty } from "@/components/ui";
import { Ring } from "@/components/ring";
import { RefreshButton } from "@/components/refresh-button";
import { Heatmap } from "@/components/charts/heatmap";
import { BarTrend, AreaTrend } from "@/components/charts/trend";
import { fetchAll } from "@/lib/fetchers";
import {
  dayKey,
  fmtDuration,
  fmtDurationCompact,
  fmtKcal,
  fmtKm,
  fmtSteps,
  groupByDay,
  lastNDays,
  sumStats,
} from "@/lib/data";

export const dynamic = "force-dynamic";

const MS_DAY = 86_400_000;
const STEPS_GOAL = 10_000;
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeekUtc(d: Date): Date {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = (utc.getUTCDay() + 6) % 7;
  return new Date(utc.getTime() - dow * MS_DAY);
}

export default async function DashboardPage() {
  const { user, sessions, weights } = await fetchAll();

  const now = new Date();
  const todayKey = dayKey(now);
  const weekStart = startOfWeekUtc(now);
  const prevWeekStart = new Date(weekStart.getTime() - 7 * MS_DAY);
  const buckets = groupByDay(sessions);

  const today = buckets.get(todayKey);
  const todaySteps = today?.steps ?? 0;
  const todayDistance = today?.distanceM ?? 0;
  const todayTime = today?.durationSec ?? 0;
  const todayKcal = today?.kcal ?? 0;
  const todayCount = today?.sessions.length ?? 0;

  // Yesterday for context — delta on the today panel.
  const yKey = dayKey(new Date(now.getTime() - MS_DAY));
  const yest = buckets.get(yKey);
  const yestSteps = yest?.steps ?? 0;

  const thisWeek = sumStats(sessions, weekStart);
  const lastWeek = sumStats(sessions, prevWeekStart, weekStart);
  const last30 = sumStats(sessions, new Date(now.getTime() - 30 * MS_DAY));
  const allTime = sumStats(sessions);

  // Average daily steps over the last 30 active days (excludes zero days).
  const last30Days = lastNDays(sessions, 30, now);
  const activeStepDays = last30Days.filter((d) => d.steps > 0);
  const avgDailySteps =
    activeStepDays.length > 0
      ? Math.round(
          activeStepDays.reduce((a, d) => a + d.steps, 0) /
            activeStepDays.length,
        )
      : 0;

  // Week-at-a-glance: 7 day buckets ending Sunday (Mon=0).
  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart.getTime() + i * MS_DAY);
    const k = dayKey(d);
    const b = buckets.get(k);
    return {
      key: k,
      dow: DOW_SHORT[i],
      isToday: k === todayKey,
      isFuture: d > now,
      steps: b?.steps ?? 0,
      distanceM: b?.distanceM ?? 0,
      durationSec: b?.durationSec ?? 0,
    };
  });
  const weekMaxSteps = Math.max(STEPS_GOAL, ...weekDays.map((d) => d.steps));

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

  const progress = todaySteps / STEPS_GOAL;
  const avgRingShare =
    avgDailySteps > 0 ? Math.min(1, avgDailySteps / STEPS_GOAL) : undefined;

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
            <p className="mt-1 text-sm text-ink-3">
              {allTime.count.toLocaleString()} sessions ·{" "}
              <span className="tnum">{fmtKm(allTime.distanceM, 1)} km</span>{" "}
              lifetime
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

      {/* TODAY — headline panel */}
      <section className="mb-6 animate-rise" style={{ animationDelay: "60ms" }}>
        <Card className="overflow-hidden">
          <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr]">
            {/* Ring */}
            <div className="flex flex-col items-center justify-center gap-4 border-line p-6 sm:p-8 lg:border-r">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">
                Today ·{" "}
                {now.toLocaleDateString("en-US", {
                  weekday: "long",
                  month: "long",
                  day: "numeric",
                })}
              </div>
              <Ring
                progress={progress}
                secondary={avgRingShare}
                size={220}
                stroke={14}
              >
                <div className="flex flex-col items-center">
                  <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
                    Steps
                  </span>
                  <span className="tnum text-4xl font-semibold tracking-tight text-ink-0">
                    {fmtSteps(todaySteps)}
                  </span>
                  <span className="mt-0.5 text-xs text-ink-3 tnum">
                    of {fmtSteps(STEPS_GOAL)} goal
                  </span>
                </div>
              </Ring>
              <div className="flex items-center gap-3 text-xs">
                <span className="inline-flex items-center gap-1.5 text-ink-3">
                  <span className="h-1.5 w-3 rounded-full bg-accent" /> today
                </span>
                {avgRingShare !== undefined ? (
                  <span className="inline-flex items-center gap-1.5 text-ink-3">
                    <span className="h-1 w-3 rounded-full bg-ink-4/50" /> 30-day avg
                  </span>
                ) : null}
              </div>
              {yestSteps > 0 ? (
                <p className="text-xs text-ink-3 tnum">
                  Yesterday: <span className="text-ink-1">{fmtSteps(yestSteps)}</span>{" "}
                  steps
                </p>
              ) : null}
            </div>

            {/* Today supporting metrics */}
            <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
              <TodayKpi
                label="Sessions"
                value={todayCount.toString()}
                sub={todayCount === 0 ? "none yet" : todayCount === 1 ? "one workout" : `${todayCount} workouts`}
              />
              <TodayKpi
                label="Distance"
                value={fmtKm(todayDistance, todayDistance < 10000 ? 2 : 1)}
                unit="km"
                icon={<Route className="h-3.5 w-3.5" />}
              />
              <TodayKpi
                label="Time"
                value={fmtDurationCompact(todayTime)}
                icon={<Timer className="h-3.5 w-3.5" />}
              />
              <TodayKpi
                label="Calories"
                value={fmtKcal(todayKcal)}
                unit="kcal"
                icon={<Flame className="h-3.5 w-3.5" />}
              />

              {/* Week strip — spans all 4 columns, daily steps Mon–Sun. */}
              <div className="col-span-2 border-t border-line p-5 sm:col-span-4">
                <div className="mb-3 flex items-end justify-between">
                  <div>
                    <div className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">
                      This week
                    </div>
                    <div className="mt-1 text-sm text-ink-3">
                      <span className="tnum text-ink-1 font-semibold">
                        {fmtSteps(thisWeek.steps)}
                      </span>{" "}
                      steps ·{" "}
                      <span className="tnum text-ink-1 font-semibold">
                        {fmtKm(thisWeek.distanceM, 1)}
                      </span>{" "}
                      km ·{" "}
                      <span className="tnum text-ink-1 font-semibold">
                        {fmtDurationCompact(thisWeek.durationSec)}
                      </span>
                    </div>
                  </div>
                  <Delta
                    cur={thisWeek.steps}
                    prev={lastWeek.steps}
                    unit="steps vs last wk"
                  />
                </div>
                <ol className="grid grid-cols-7 gap-2">
                  {weekDays.map((d) => {
                    const pct =
                      weekMaxSteps > 0
                        ? Math.min(1, d.steps / weekMaxSteps)
                        : 0;
                    return (
                      <li key={d.key}>
                        <Link
                          href={`/day/${d.key}`}
                          className={`group flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                            d.isToday
                              ? "border-accent bg-accent-soft"
                              : "border-line bg-paper-0 hover:bg-paper-2"
                          } ${d.isFuture ? "opacity-40" : ""}`}
                        >
                          <span
                            className={`text-[10px] font-medium uppercase tracking-wider ${
                              d.isToday ? "text-ink-0" : "text-ink-3"
                            }`}
                          >
                            {d.dow}
                          </span>
                          <div
                            className="relative w-full overflow-hidden rounded-md bg-paper-2"
                            style={{ height: 56 }}
                          >
                            <div
                              className="absolute inset-x-0 bottom-0 rounded-md bg-accent transition-all"
                              style={{ height: `${pct * 100}%` }}
                            />
                          </div>
                          <span
                            className={`tnum text-[11px] font-semibold ${
                              d.isToday ? "text-ink-0" : "text-ink-2"
                            }`}
                          >
                            {d.steps > 0
                              ? d.steps >= 1000
                                ? `${(d.steps / 1000).toFixed(1)}k`
                                : d.steps.toString()
                              : "—"}
                          </span>
                        </Link>
                      </li>
                    );
                  })}
                </ol>
              </div>
            </div>
          </div>
        </Card>
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
                        {s.startTime.toLocaleString("en-US", {
                          weekday: "short",
                          month: "short",
                          day: "numeric",
                          hour: "numeric",
                          minute: "2-digit",
                        })}
                      </div>
                      <div className="truncate text-xs text-ink-3 tnum">
                        {s.model} · {fmtSteps(s.steps)} steps
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

function TodayKpi({
  label,
  value,
  unit,
  sub,
  icon,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
}) {
  return (
    <div className="flex flex-col gap-2 p-5 sm:p-6">
      <div className="flex items-center justify-between gap-2 text-[11px] font-medium uppercase tracking-[0.14em] text-ink-3">
        <span>{label}</span>
        {icon ? <span className="text-ink-4">{icon}</span> : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-2xl font-semibold tracking-tight text-ink-0 sm:text-3xl">
          {value}
        </span>
        {unit ? (
          <span className="text-xs font-medium text-ink-3">{unit}</span>
        ) : null}
      </div>
      {sub ? <div className="text-xs text-ink-3">{sub}</div> : null}
    </div>
  );
}

function greet(d: Date): string {
  const h = d.getHours();
  if (h < 5) return "Up late";
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}

function Delta({
  cur,
  prev,
  unit,
}: {
  cur: number;
  prev: number;
  unit: string;
}) {
  if (prev === 0 && cur === 0) {
    return (
      <span className="text-xs text-ink-4 tnum">
        — {unit}
      </span>
    );
  }
  const pct = prev === 0 ? 100 : Math.round(((cur - prev) / prev) * 100);
  const positive = pct >= 0;
  return (
    <span
      className={`inline-flex items-center text-xs tnum ${
        positive ? "text-[color:var(--positive)]" : "text-[color:var(--bad)]"
      }`}
    >
      {positive ? (
        <TrendingUp className="mr-1 h-3 w-3" />
      ) : (
        <TrendingDown className="mr-1 h-3 w-3" />
      )}
      {positive ? "+" : ""}
      {pct}% <span className="ml-1 text-ink-3">{unit}</span>
    </span>
  );
}
