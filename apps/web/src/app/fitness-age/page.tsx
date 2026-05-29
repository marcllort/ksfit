import { Shell } from "@/components/shell";
import { Card, Empty, Pill, Metric } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { metricFitnessAge } from "@/lib/health/metrics-fetchers";
import { HeartPulse } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Fitness Age · Stride" };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function FitnessAgePage() {
  const { user } = await fetchAll();
  if (!(await fitbitConnected())) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Fitness Age
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Fitness Age
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
                  to see your fitness age.
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
  const fa = await metricFitnessAge(date);
  const fitnessAge = fa?.fitnessAge ?? null;
  const pace = fa?.paceOfAging ?? null;

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Fitness Age
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Fitness Age (cardiorespiratory)
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            VO2max vs age/sex norms · {date} · not biological age
          </p>
        </div>
        <Pill tone="muted">
          confidence: {fa?.confidence ?? "unavailable"}
        </Pill>
      </header>

      {fitnessAge == null ? (
        <Card>
          <div className="p-8">
            <Pill tone="warn">Needs VO2max</Pill>
            <p className="mt-3 text-sm text-ink-2">
              We don&apos;t have a device VO2max (cardio score) yet, so there&apos;s
              no honest way to map a fitness age. Take a GPS-tracked run or
              brisk walk on your Fitbit to let it estimate your VO2max.
            </p>
            {fa?.reason ? (
              <p className="mt-3 text-xs text-ink-4">{fa.reason}</p>
            ) : null}
          </div>
        </Card>
      ) : (
        <>
          <Card className="mb-6">
            <div className="flex flex-col items-start gap-6 p-8 sm:flex-row sm:items-center sm:gap-12">
              <div>
                <div className="flex items-baseline gap-2">
                  <span className="tnum text-6xl font-semibold text-ink-0">
                    {Math.round(fitnessAge)}
                  </span>
                  <span className="text-lg text-ink-3">yrs</span>
                </div>
                <p className="mt-1 text-sm text-ink-3">cardiorespiratory fitness age</p>
              </div>
              {pace != null ? (
                <div>
                  <Pill tone={pace <= 0 ? "good" : "warn"}>
                    {pace <= 0 ? "younger" : "older"} than your years
                  </Pill>
                  <div
                    className={
                      "mt-2 tnum text-3xl font-semibold " +
                      (pace <= 0
                        ? "text-[color:var(--positive)]"
                        : "text-[color:var(--warn)]")
                    }
                  >
                    {pace > 0 ? "+" : ""}
                    {pace.toFixed(1)} yrs
                  </div>
                  <p className="mt-1 text-xs text-ink-4">pace of aging vs chronological</p>
                </div>
              ) : null}
            </div>
          </Card>

          <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
            <Card className="p-0">
              <Metric
                label="VO2max"
                value={fa?.vo2max != null ? fa.vo2max.toFixed(1) : "—"}
                unit={fa?.vo2max != null ? "ml/kg/min" : undefined}
                icon={<HeartPulse className="h-4 w-4" />}
              />
            </Card>
            <Card className="p-0">
              <Metric label="Method" value={fa?.method ?? "—"} />
            </Card>
            <Card className="p-0">
              <Metric label="Confidence" value={fa?.confidence ?? "—"} />
            </Card>
          </section>

          <p className="mt-6 text-xs text-ink-4">
            Norm table is an interim placeholder pending verification against the
            HUNT (Nes 2011) primary source — treat this as a rough estimate.
          </p>
        </>
      )}
    </Shell>
  );
}
