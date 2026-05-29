import { Shell } from "@/components/shell";
import { Card, CardHeader, Empty, Pill, Metric } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { metricSleep } from "@/lib/health/metrics-fetchers";
import { Moon } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sleep · Stride" };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}
function fmtMin(min: number): string {
  const h = Math.floor(min / 60);
  const m = Math.round(min % 60);
  return h > 0 ? `${h}h ${m}m` : `${m}m`;
}

export default async function SleepPage() {
  const { user } = await fetchAll();
  if (!(await fitbitConnected())) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Sleep
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Sleep
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
                  to see your sleep performance.
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

  const date = todayKey();
  const sleep = await metricSleep(date);
  const tonight = sleep?.tonight ?? null;
  const performance = sleep?.performance ?? null;
  const stages = tonight?.stages;

  const stageRows = stages
    ? ([
        { label: "Deep", min: stages.deep },
        { label: "REM", min: stages.rem },
        { label: "Light", min: stages.light },
        { label: "Awake", min: stages.wake },
      ] as const)
    : [];
  const stageTotal = stageRows.reduce((s, r) => s + r.min, 0) || 1;

  const recCopy = (r: NonNullable<typeof sleep>["recommendations"][number]): string => {
    switch (r.kind) {
      case "short":
        return `You fell ${fmtMin(r.shortfallMin)} short of your need — aim for an earlier bedtime tonight.`;
      case "debt":
        return `You're carrying ${fmtMin(r.debtMin)} of recent sleep debt — bank extra sleep over the next few nights.`;
      case "fragmented":
        return `Sleep was fragmented (${r.efficiency}% efficiency) — limit screens and caffeine before bed.`;
    }
  };

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Sleep
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Sleep performance
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Today ({date}) · stages direct from Fitbit · need is a Stride estimate
          </p>
        </div>
        <Pill tone="muted">Need/debt derived</Pill>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-0">
          <Metric
            label="Performance"
            value={performance != null ? performance : "—"}
            unit={performance != null ? "%" : undefined}
            icon={<Moon className="h-4 w-4" />}
            sub="asleep ÷ need"
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Asleep"
            value={tonight ? fmtMin(tonight.asleepMin) : "—"}
            sub={tonight ? `${tonight.efficiency}% efficiency` : undefined}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Need"
            value={sleep ? fmtMin(sleep.need.need) : "—"}
            sub={sleep ? `baseline ${fmtMin(sleep.baselineNeed)}` : undefined}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Sleep debt"
            value={sleep ? fmtMin(sleep.debt) : "—"}
            sub="decaying 5-night"
          />
        </Card>
      </section>

      {stageRows.length > 0 ? (
        <Card className="mb-6">
          <CardHeader title="Stages" hint={`Wake date · ${date}`} />
          <div className="px-5 pb-5">
            <div className="flex h-4 overflow-hidden rounded-full">
              {stageRows.map((r, i) => (
                <div
                  key={r.label}
                  className={
                    [
                      "bg-[color:var(--accent)]",
                      "bg-[color:var(--positive)]",
                      "bg-paper-3",
                      "bg-[color:var(--warn)]",
                    ][i]
                  }
                  style={{ width: `${(r.min / stageTotal) * 100}%` }}
                  title={`${r.label} ${fmtMin(r.min)}`}
                />
              ))}
            </div>
            <div className="mt-4 grid grid-cols-2 gap-px overflow-hidden rounded-xl bg-line sm:grid-cols-4">
              {stageRows.map((r) => (
                <div key={r.label} className="bg-paper-1 p-3">
                  <div className="text-xs uppercase tracking-[0.12em] text-ink-3">
                    {r.label}
                  </div>
                  <div className="mt-1 tnum text-lg font-semibold text-ink-0">
                    {fmtMin(r.min)}
                  </div>
                  <div className="text-xs text-ink-4 tnum">
                    {Math.round((r.min / stageTotal) * 100)}%
                  </div>
                </div>
              ))}
            </div>
          </div>
        </Card>
      ) : null}

      {sleep ? (
        <Card className="mb-6">
          <CardHeader
            title="Need breakdown"
            hint="How tonight's sleep need is built (minutes)"
          />
          <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-line sm:grid-cols-4">
            {(
              [
                { label: "Baseline", v: sleep.need.baseline },
                { label: "+ Debt", v: sleep.need.debt },
                { label: "+ Strain", v: sleep.need.strainAdj },
                { label: "− Nap credit", v: -sleep.need.napCredit },
              ] as const
            ).map((row) => (
              <div key={row.label} className="bg-paper-1 p-4">
                <div className="text-xs uppercase tracking-[0.12em] text-ink-3">
                  {row.label}
                </div>
                <div className="mt-1 tnum text-lg font-semibold text-ink-0">
                  {row.v >= 0 ? "" : "−"}
                  {fmtMin(Math.abs(row.v))}
                </div>
              </div>
            ))}
          </div>
        </Card>
      ) : null}

      <Card>
        <CardHeader title="Recommendations" hint="Rule-based · not the AI coach" />
        <div className="p-5">
          {sleep && sleep.recommendations.length > 0 ? (
            <ul className="space-y-2">
              {sleep.recommendations.map((r, i) => (
                <li
                  key={i}
                  className="flex items-start gap-2 text-sm text-ink-2"
                >
                  <span className="mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full bg-accent" />
                  {recCopy(r)}
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-sm text-ink-3">
              No flags — your sleep met its estimated need with no significant
              debt or fragmentation.
            </p>
          )}
        </div>
      </Card>
    </Shell>
  );
}
