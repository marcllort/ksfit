import { notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Clock,
  Flame,
  Footprints,
  Gauge,
  HeartPulse,
  Route,
  Timer,
} from "lucide-react";
import { Shell } from "@/components/shell";
import { Card, CardHeader, Metric, Pill, Empty } from "@/components/ui";
import { ExportButton } from "@/components/export-button";
import { FitbitPushButton } from "@/components/fitbit/push-button";
import { SessionChart } from "@/components/charts/session-chart";
import { fitbitConnected, fitbitHeartRateForDay } from "@/lib/health/fetchers";
import { isLogged } from "@/lib/health/fitbit/logged";
import { requireSession } from "@/lib/session";
import { fetchRecordPoints, fetchSessions } from "@/lib/fetchers";
import {
  fmtDate,
  fmtDateTime,
  fmtDuration,
  fmtKcal,
  fmtKm,
  fmtPace,
  fmtSteps,
  fmtTime,
  parsePointList,
  type SessionPoint,
} from "@/lib/data";

export const dynamic = "force-dynamic";

export default async function SessionDetailPage({
  params,
}: {
  params: Promise<{ run_id: string }>;
}) {
  const { run_id } = await params;
  const session = await requireSession();

  // Session metadata reuses the cached sport-records list; per-session
  // telemetry has its own long-lived cache (record_points are immutable).
  // fetchSessions installs the rotation-persist handler for both calls below.
  const { user, sessions: all } = await fetchSessions(session);
  const pointsResp = await fetchRecordPoints(session, run_id).catch(() => null);

  const s = all.find((x) => x.runId === run_id);
  if (!s) notFound();

  const points: SessionPoint[] = parsePointList(pointsResp);

  // Trustworthy heart rate from Fitbit (the KS Fit `heart` field is ambiguously
  // scaled). Fetch the session day's intraday series and window it to the
  // workout's start/end. Fails soft to null when Fitbit isn't connected.
  const dayKeyUtc = s.startTime.toISOString().slice(0, 10);
  const fitbitHr = await fitbitHeartRateForDay(dayKeyUtc, true);
  const hrInWindow =
    fitbitHr?.intraday.filter(
      (p) => p.t >= s.startTime.getTime() && p.t <= s.endTime.getTime(),
    ) ?? [];
  const hr = {
    points: hrInWindow.map((p) => ({ t: p.t, bpm: p.bpm })),
    avg: hrInWindow.length
      ? Math.round(hrInWindow.reduce((a, p) => a + p.bpm, 0) / hrInWindow.length)
      : 0,
    peak: hrInWindow.length ? Math.max(...hrInWindow.map((p) => p.bpm)) : 0,
  };
  // Map HR onto the telemetry timeline (elapsed seconds) for the chart overlay.
  const hrByElapsed = hr.points.map((p) => ({
    t: Math.round((p.t - s.startTime.getTime()) / 1000),
    bpm: p.bpm,
  }));

  const fbConnected = await fitbitConnected();
  const alreadyLogged = fbConnected ? await isLogged(run_id) : false;

  // Splits (per-km). Walk through the cumulative-distance time series.
  type Split = { km: number; durationSec: number; pace: number };
  const splits: Split[] = [];
  if (points.length > 1) {
    let nextKm = 1;
    let prevT = 0;
    let prevDist = 0;
    for (const p of points) {
      // Cross a km threshold? Linearly interpolate the crossing time.
      while (p.distanceM >= nextKm * 1000 && p.distanceM > prevDist) {
        const target = nextKm * 1000;
        const frac =
          (target - prevDist) / (p.distanceM - prevDist || 1);
        const tAt = prevT + frac * (p.t - prevT);
        const prevSplitEnd = splits.length
          ? splits.reduce((a, sp) => a + sp.durationSec, 0)
          : 0;
        const dur = Math.max(1, Math.round(tAt - prevSplitEnd));
        splits.push({
          km: nextKm,
          durationSec: dur,
          pace: dur,
        });
        nextKm += 1;
      }
      prevDist = p.distanceM;
      prevT = p.t;
    }
  }

  const peakSpeed =
    points.length > 0 ? Math.max(...points.map((p) => p.speedKmh)) : 0;
  const avgCadence =
    points.length > 0
      ? Math.round(
          points.reduce((a, p) => a + (p.cadence || 0), 0) /
            Math.max(1, points.filter((p) => p.cadence > 0).length),
        )
      : 0;

  // Moving time: sum the gaps between samples where speed was non-zero. Lets us
  // show "moving" vs total when a session has paused stretches (speed = 0).
  let movingSec = 0;
  for (let i = 1; i < points.length; i++) {
    if (points[i].speedKmh > 0.1) movingSec += points[i].t - points[i - 1].t;
  }
  const hasPauses = movingSec > 0 && movingSec < s.durationSec - 5;

  // Fastest km from the per-km splits.
  const fastestKm = splits.length
    ? splits.reduce((m, sp) => (sp.pace < m.pace ? sp : m), splits[0])
    : null;

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <Link
        href="/sessions"
        className="mb-4 inline-flex items-center gap-1 text-sm text-ink-3 hover:text-ink-0"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to sessions
      </Link>

      {/* Hero */}
      <header className="mb-8">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
              {fmtDate(s.startTime, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              })}
            </p>
            <h1 className="mt-2 tnum text-4xl font-semibold tracking-tight text-ink-0 sm:text-5xl">
              {fmtKm(s.distanceM)} <span className="text-2xl text-ink-3">km</span>
            </h1>
            <p className="mt-1 text-sm text-ink-3">
              {fmtTime(s.startTime, {
                hour: "numeric",
                minute: "2-digit",
              })}{" "}
              · {fmtDuration(s.durationSec)} ·{" "}
              <span className="tnum">{s.avgSpeedKmh.toFixed(2)} km/h avg</span>
            </p>
          </div>
          <div className="flex flex-col items-end gap-3">
            <div className="flex flex-wrap justify-end gap-2">
              <Pill tone="default">{s.model}</Pill>
              {s.isAppleWatch ? <Pill tone="default">Apple Watch</Pill> : null}
              {s.courseName ? <Pill tone="accent">{s.courseName}</Pill> : null}
            </div>
            <div className="flex flex-wrap justify-end gap-2">
              {fbConnected ? (
                <FitbitPushButton runId={run_id} alreadyLogged={alreadyLogged} />
              ) : null}
              {points.length > 0 ? (
                <ExportButton
                  href={`/api/export/points/${run_id}`}
                  label="Export telemetry"
                />
              ) : null}
            </div>
          </div>
        </div>
      </header>

      {/* KPI strip */}
      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 md:grid-cols-3 lg:grid-cols-6">
        <Card className="p-0"><Metric label="Distance" value={fmtKm(s.distanceM)} unit="km" icon={<Route className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="Time" value={fmtDuration(s.durationSec)} icon={<Timer className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="Pace" value={fmtPace(s.paceSecPerKm)} unit="/km" icon={<Clock className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="Steps" value={fmtSteps(s.steps)} icon={<Footprints className="h-4 w-4"/>} /></Card>
        <Card className="p-0"><Metric label="Calories" value={fmtKcal(s.kcal)} unit="kcal" icon={<Flame className="h-4 w-4"/>} /></Card>
        {hr.avg > 0 ? (
          <Card className="p-0"><Metric label="Avg HR" value={hr.avg} unit="bpm" sub={`peak ${hr.peak}`} icon={<HeartPulse className="h-4 w-4"/>} /></Card>
        ) : (
          <Card className="p-0"><Metric label="Peak speed" value={peakSpeed.toFixed(1)} unit="km/h" icon={<Gauge className="h-4 w-4"/>} /></Card>
        )}
      </section>

      {/* Chart */}
      <Card className="mb-6">
        <CardHeader
          title="Speed over time"
          hint={
            points.length > 0
              ? `${points.length} samples · ${points.length > 0 ? fmtPace(Math.round(s.durationSec / Math.max(1, points.length))) : ""} between samples`
              : "No per-second telemetry returned for this session"
          }
          action={
            avgCadence > 0 ? (
              <Pill tone="muted">avg cadence {avgCadence} spm</Pill>
            ) : null
          }
        />
        <div className="px-2 pb-4">
          {points.length > 1 ? (
            <SessionChart points={points} hr={hrByElapsed} />
          ) : (
            <Empty>
              {pointsResp === null
                ? "Couldn't load per-second telemetry."
                : "This session has no per-second telemetry — it may have been recorded outside the WalkingPad app."}
            </Empty>
          )}
        </div>
      </Card>

      {/* Splits */}
      <Card className="mb-6">
        <CardHeader
          title="Splits"
          hint={`Per-kilometre breakdown · ${splits.length} full split${splits.length === 1 ? "" : "s"}`}
          action={
            <div className="flex flex-wrap justify-end gap-2">
              {hasPauses ? (
                <Pill tone="muted">{fmtDuration(movingSec)} moving</Pill>
              ) : null}
              {fastestKm ? (
                <Pill tone="good">
                  fastest km {fmtPace(fastestKm.pace)} (#{fastestKm.km})
                </Pill>
              ) : null}
            </div>
          }
        />
        {splits.length === 0 ? (
          <div className="p-5"><Empty>Not enough distance for a split.</Empty></div>
        ) : (
          <div className="px-2 pb-4">
            <SplitTable splits={splits} sessionPace={s.paceSecPerKm} />
          </div>
        )}
      </Card>

      <div className="grid gap-4 md:grid-cols-2">
        <Card>
          <CardHeader title="Session info" />
          <dl className="grid grid-cols-2 gap-y-3 px-5 pb-5 text-sm">
            <dt className="text-ink-3">Start</dt>
            <dd className="tnum text-right text-ink-1">
              {fmtDateTime(s.startTime, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
            <dt className="text-ink-3">End</dt>
            <dd className="tnum text-right text-ink-1">
              {fmtDateTime(s.endTime, {
                dateStyle: "medium",
                timeStyle: "short",
              })}
            </dd>
            <dt className="text-ink-3">Device</dt>
            <dd className="text-right text-ink-1">
              {s.model}
              <span className="ml-1 text-ink-3 tnum">{s.deviceId}</span>
            </dd>
            <dt className="text-ink-3">Run ID</dt>
            <dd className="text-right tnum text-ink-1">{s.runId}</dd>
          </dl>
        </Card>

        <Card>
          <CardHeader title="Derived" />
          <dl className="grid grid-cols-2 gap-y-3 px-5 pb-5 text-sm">
            <dt className="text-ink-3">Avg speed</dt>
            <dd className="tnum text-right text-ink-1">
              {s.avgSpeedKmh.toFixed(2)} km/h
            </dd>
            <dt className="text-ink-3">Peak speed</dt>
            <dd className="tnum text-right text-ink-1">
              {peakSpeed.toFixed(1)} km/h
            </dd>
            <dt className="text-ink-3">Step length</dt>
            <dd className="tnum text-right text-ink-1">
              {s.steps > 0 ? `${(s.distanceM / s.steps).toFixed(2)} m` : "—"}
            </dd>
            <dt className="text-ink-3">kcal / km</dt>
            <dd className="tnum text-right text-ink-1">
              {s.distanceM > 0
                ? `${(s.kcal / (s.distanceM / 1000)).toFixed(1)}`
                : "—"}
            </dd>
          </dl>
        </Card>
      </div>
    </Shell>
  );
}

function SplitTable({
  splits,
  sessionPace,
}: {
  splits: { km: number; durationSec: number; pace: number }[];
  sessionPace: number;
}) {
  const max = Math.max(...splits.map((s) => s.durationSec));
  const min = Math.min(...splits.map((s) => s.durationSec));
  return (
    <div className="px-3 pt-2">
      {splits.map((s) => {
        const ratio = max === min ? 1 : (s.durationSec - min) / (max - min || 1);
        // Faster splits (smaller durationSec) → fuller accent bar.
        const fillPct = 100 - ratio * 50; // 50-100%
        return (
          <div
            key={s.km}
            className="grid grid-cols-[44px_1fr_56px_56px] items-center gap-3 py-2"
          >
            <div className="tnum text-xs font-medium text-ink-3">
              km {s.km}
            </div>
            <div className="relative h-2 overflow-hidden rounded-full bg-paper-2">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${fillPct}%` }}
              />
            </div>
            <div className="text-right tnum text-xs text-ink-3">
              {fmtDuration(s.durationSec)}
            </div>
            <div
              className={`text-right tnum text-xs font-semibold ${
                s.pace <= sessionPace
                  ? "text-[color:var(--positive)]"
                  : "text-ink-2"
              }`}
            >
              {fmtPace(s.pace)}
            </div>
          </div>
        );
      })}
    </div>
  );
}
