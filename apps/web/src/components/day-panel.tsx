/**
 * Headline panel for a single day. Renders the steps ring, supporting KPIs,
 * a contextual comparison line, and a Mon–Sun strip anchored on the date.
 *
 * Used on both the Overview (date = today) and /day/[date] (any date). The
 * "today" mode adds a "so far" sub-label on KPIs and drops the prev/next
 * navigation; the "any day" mode adds prev/next pills and a "Today" return
 * chip so the same panel doubles as a day browser.
 */
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  CalendarDays,
  Flame,
  Gauge,
  Route,
  Timer,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { Card, Pill } from "@/components/ui";
import { Ring } from "@/components/ring";
import type { NormalizedSession } from "@stride/ksfit-client/data";
import {
  bucketFor,
  dayKey,
  fmtDurationCompact,
  fmtKcal,
  fmtKm,
  fmtPace,
  fmtSteps,
  groupByDay,
  sameWeekdayAvg,
} from "@stride/ksfit-client/data";

const MS_DAY = 86_400_000;
const DOW_SHORT = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

function startOfWeekUtc(d: Date): Date {
  const utc = new Date(
    Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()),
  );
  const dow = (utc.getUTCDay() + 6) % 7;
  return new Date(utc.getTime() - dow * MS_DAY);
}

function parseUtcDate(date: string): Date {
  return new Date(date + "T00:00:00Z");
}

function fmtAdjDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

interface Props {
  date: string;
  sessions: NormalizedSession[];
  stepsGoal: number;
  now?: Date;
}

export function DayPanel({ date, sessions, stepsGoal, now }: Props) {
  const today = now ?? new Date();
  const todayKey = dayKey(today);
  const isToday = date === todayKey;

  const buckets = groupByDay(sessions);
  const target = bucketFor(buckets, date);
  const targetDate = parseUtcDate(date);
  const prevKey = fmtAdjDate(new Date(targetDate.getTime() - MS_DAY));
  const nextKey = fmtAdjDate(new Date(targetDate.getTime() + MS_DAY));
  const nextIsFuture = parseUtcDate(nextKey) > today;

  const weekStart = startOfWeekUtc(targetDate);
  const weekDays = Array.from({ length: 7 }).map((_, i) => {
    const d = new Date(weekStart.getTime() + i * MS_DAY);
    const k = dayKey(d);
    const b = buckets.get(k);
    return {
      key: k,
      dow: DOW_SHORT[i],
      isSelected: k === date,
      isToday: k === todayKey,
      isFuture: d > today,
      steps: b?.steps ?? 0,
    };
  });
  const weekMaxSteps = Math.max(stepsGoal, ...weekDays.map((d) => d.steps));

  const goalShare = stepsGoal > 0 ? target.steps / stepsGoal : 0;
  const sameDowAvg = sameWeekdayAvg(buckets, date, 8);
  const avgRingShare =
    stepsGoal > 0 && sameDowAvg > 0
      ? Math.min(1, sameDowAvg / stepsGoal)
      : undefined;

  // Pace and avg-speed for the day are session-weighted: aggregate over all
  // sessions then derive, so a short fast walk doesn't bias against a long
  // slow one.
  const targetSessions = target.sessions;
  const dayPaceSecPerKm =
    target.distanceM > 0
      ? Math.round(target.durationSec / (target.distanceM / 1000))
      : 0;
  const avgPaceForEta =
    dayPaceSecPerKm > 0
      ? dayPaceSecPerKm
      : avgPaceFromHistory(sessions);

  // Long-format weekday name used in the comparison copy ("vs same Sunday").
  const weekdayLong = targetDate.toLocaleDateString("en-US", {
    weekday: "long",
    timeZone: "UTC",
  });
  const headerDate = targetDate.toLocaleDateString("en-US", {
    weekday: "long",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });

  const wkDeltaPct =
    sameDowAvg > 0
      ? Math.round(((target.steps - sameDowAvg) / sameDowAvg) * 100)
      : null;

  return (
    <Card className="overflow-hidden">
      {/* Sub-header: date label on the left, day-nav on the right. The "Today"
          return chip only shows when we're not already there. */}
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-5 py-3">
        <div className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">
          {isToday ? "Today" : weekdayLong} · {headerDate}
          {isToday ? (
            <span className="ml-2 inline-flex items-center gap-1 rounded-full bg-accent-soft px-2 py-0.5 text-[10px] font-medium text-ink-2">
              <span
                className="inline-block h-1.5 w-1.5 animate-pulse rounded-full bg-accent"
                aria-hidden
              />
              live
            </span>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Link href={`/day/${prevKey}`}>
            <Pill tone="default" className="cursor-pointer hover:bg-paper-3">
              <ArrowLeft className="mr-1 h-3 w-3" />
              {prevKey}
            </Pill>
          </Link>
          {nextIsFuture ? (
            <Pill tone="muted" className="opacity-50">
              {nextKey}
              <ArrowRight className="ml-1 h-3 w-3" />
            </Pill>
          ) : (
            <Link href={`/day/${nextKey}`}>
              <Pill tone="default" className="cursor-pointer hover:bg-paper-3">
                {nextKey}
                <ArrowRight className="ml-1 h-3 w-3" />
              </Pill>
            </Link>
          )}
          {!isToday ? (
            <Link href="/">
              <Pill tone="accent" className="cursor-pointer">
                <CalendarDays className="mr-1 h-3 w-3" />
                Today
              </Pill>
            </Link>
          ) : null}
        </div>
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-[auto_1fr]">
        {/* Ring + center read-out + comparison line */}
        <div className="flex flex-col items-center justify-center gap-4 border-line p-6 sm:p-8 lg:border-r">
          <Ring progress={goalShare} secondary={avgRingShare} size={220} stroke={14}>
            <div className="flex flex-col items-center">
              <span className="text-[10px] font-medium uppercase tracking-wider text-ink-3">
                Steps
              </span>
              <span className="tnum text-4xl font-semibold tracking-tight text-ink-0">
                {fmtSteps(target.steps)}
              </span>
              <span className="mt-0.5 text-xs text-ink-3 tnum">
                of {fmtSteps(stepsGoal)} goal
              </span>
              {targetSessions.length > 0 ? (
                <span className="mt-1 text-[10px] uppercase tracking-wider text-ink-4 tnum">
                  {targetSessions.length}{" "}
                  {targetSessions.length === 1 ? "workout" : "workouts"}
                </span>
              ) : null}
            </div>
          </Ring>
          <div className="flex flex-wrap items-center justify-center gap-3 text-[11px]">
            <span className="inline-flex items-center gap-1.5 text-ink-3">
              <span className="h-1.5 w-3 rounded-full bg-accent" />
              {isToday ? "today" : weekdayLong.toLowerCase()}
            </span>
            {avgRingShare !== undefined ? (
              <span className="inline-flex items-center gap-1.5 text-ink-3 tnum">
                <span className="h-1 w-3 rounded-full bg-ink-3/80" />
                same-weekday avg · {fmtSteps(sameDowAvg)}
              </span>
            ) : null}
          </div>
          <CompareLine
            steps={target.steps}
            stepsGoal={stepsGoal}
            wkDeltaPct={wkDeltaPct}
            weekdayLong={weekdayLong}
            avgPaceForEta={avgPaceForEta}
            isToday={isToday}
          />
        </div>

        {/* KPIs + week strip */}
        <div className="grid grid-cols-2 divide-line sm:grid-cols-4 sm:divide-x">
          <Kpi
            label="Distance"
            value={fmtKm(target.distanceM, target.distanceM < 10000 ? 2 : 1)}
            unit="km"
            icon={<Route className="h-3.5 w-3.5" />}
            sub={isToday ? "so far" : undefined}
          />
          <Kpi
            label="Time"
            value={fmtDurationCompact(target.durationSec)}
            icon={<Timer className="h-3.5 w-3.5" />}
            sub={isToday ? "so far" : undefined}
          />
          <Kpi
            label="Calories"
            value={fmtKcal(target.kcal)}
            unit="kcal"
            icon={<Flame className="h-3.5 w-3.5" />}
            sub={isToday ? "so far" : undefined}
          />
          <Kpi
            label="Pace"
            value={dayPaceSecPerKm > 0 ? fmtPace(dayPaceSecPerKm) : "—"}
            unit={dayPaceSecPerKm > 0 ? "/km" : undefined}
            icon={<Gauge className="h-3.5 w-3.5" />}
            sub={
              dayPaceSecPerKm > 0
                ? `${(3600 / dayPaceSecPerKm).toFixed(2)} km/h`
                : "no distance"
            }
          />

          {/* Week strip — anchored on the week containing `date`. */}
          <div className="col-span-2 border-t border-line p-5 sm:col-span-4">
            <div className="mb-3 flex items-end justify-between">
              <div className="text-xs font-medium uppercase tracking-[0.14em] text-ink-3">
                {isToday ? "This week" : "Week of " + fmtAdjDate(weekStart)}
              </div>
              <div className="text-[11px] text-ink-4">
                Click a day to switch
              </div>
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
                      aria-current={d.isSelected ? "page" : undefined}
                      className={`group flex flex-col items-center gap-1 rounded-xl border p-2 transition-colors ${
                        d.isSelected
                          ? "border-accent bg-accent-soft"
                          : "border-line bg-paper-0 hover:bg-paper-2"
                      } ${d.isFuture ? "opacity-40 pointer-events-none" : ""}`}
                    >
                      <span
                        className={`flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider ${
                          d.isSelected ? "text-ink-0" : "text-ink-3"
                        }`}
                      >
                        {d.dow}
                        {d.isToday && !d.isSelected ? (
                          <span
                            className="h-1 w-1 rounded-full bg-accent"
                            aria-label="today"
                          />
                        ) : null}
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
                          d.isSelected ? "text-ink-0" : "text-ink-2"
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
  );
}

/** Tiny KPI cell used inside the panel grid. Smaller than the standalone
 *  `Metric` component so the panel doesn't dominate the page. */
function Kpi({
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

/** Renders 1–2 sentences worth of contextual numbers under the ring:
 *  - "steps to goal" + ETA at your usual pace when today is below goal
 *  - "Goal hit" pill when at/over goal
 *  - "+/-N% vs same {weekday}" when there's a weekday baseline to compare to
 */
function CompareLine({
  steps,
  stepsGoal,
  wkDeltaPct,
  weekdayLong,
  avgPaceForEta,
  isToday,
}: {
  steps: number;
  stepsGoal: number;
  wkDeltaPct: number | null;
  weekdayLong: string;
  avgPaceForEta: number;
  isToday: boolean;
}) {
  const hit = steps >= stepsGoal;
  const remaining = Math.max(0, stepsGoal - steps);
  // Rough ETA: assume an average step length of 0.72 m (walking treadmill
  // norm) for the steps-to-goal projection, then convert remaining metres
  // to minutes at the user's typical pace.
  const STEP_M = 0.72;
  const remainingM = remaining * STEP_M;
  const etaMin =
    avgPaceForEta > 0 && remainingM > 0
      ? Math.round((remainingM / 1000) * (avgPaceForEta / 60))
      : 0;

  const parts: React.ReactNode[] = [];

  if (isToday && !hit && remaining > 0) {
    parts.push(
      <span key="todo" className="tnum">
        <strong className="text-ink-1">{fmtSteps(remaining)}</strong> to goal
        {etaMin > 0 ? (
          <span className="text-ink-3">
            {" "}
            · ≈ <span className="tnum">{etaMin}</span> min at your pace
          </span>
        ) : null}
      </span>,
    );
  } else if (hit) {
    parts.push(
      <span
        key="hit"
        className="inline-flex items-center gap-1 rounded-full bg-[color:var(--positive)]/10 px-2 py-0.5 text-[11px] font-medium text-[color:var(--positive)]"
      >
        <TrendingUp className="h-3 w-3" />
        Goal hit
        {steps > stepsGoal ? (
          <span className="ml-1 tnum">
            · +{fmtSteps(steps - stepsGoal)} over
          </span>
        ) : null}
      </span>,
    );
  }

  if (wkDeltaPct !== null && Number.isFinite(wkDeltaPct)) {
    const positive = wkDeltaPct >= 0;
    parts.push(
      <span
        key="wk"
        className={`inline-flex items-center gap-1 tnum ${
          positive
            ? "text-[color:var(--positive)]"
            : "text-[color:var(--bad)]"
        }`}
      >
        {positive ? (
          <TrendingUp className="h-3 w-3" />
        ) : (
          <TrendingDown className="h-3 w-3" />
        )}
        {positive ? "+" : ""}
        {wkDeltaPct}%
        <span className="text-ink-3">vs same {weekdayLong}</span>
      </span>,
    );
  }

  if (parts.length === 0) {
    return (
      <p className="text-xs text-ink-4">
        No baseline yet — keep stacking days.
      </p>
    );
  }

  return (
    <div className="flex flex-wrap items-center justify-center gap-x-3 gap-y-1 text-xs text-ink-3">
      {parts.map((p, i) => (
        <span key={i} className="inline-flex items-center">
          {i > 0 ? <span className="mr-3 text-ink-5">·</span> : null}
          {p}
        </span>
      ))}
    </div>
  );
}

/** Falls back to the most recent N sessions' aggregate pace when the target
 *  day has no recorded distance yet — useful for the "ETA at your pace"
 *  projection on a fresh morning with zero steps. */
function avgPaceFromHistory(sessions: NormalizedSession[], n = 10): number {
  const recent = sessions.slice(0, n);
  const dist = recent.reduce((a, s) => a + s.distanceM, 0);
  const dur = recent.reduce((a, s) => a + s.durationSec, 0);
  if (dist <= 0) return 0;
  return Math.round(dur / (dist / 1000));
}
