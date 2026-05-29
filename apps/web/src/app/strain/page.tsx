import { Shell } from "@/components/shell";
import { Card, Empty, Pill, Metric } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { metricStrain } from "@/lib/health/metrics-fetchers";
import { Flame } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Strain · Stride" };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function StrainPage() {
  const { user } = await fetchAll();
  if (!(await fitbitConnected())) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Strain
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Day Strain
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
                  to see your day strain.
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
  const strain = await metricStrain(date);
  const value = strain?.strain ?? 0;
  const calibrating = strain?.calibrating ?? true;
  const pct = Math.min(1, value / 21);

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Strain
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Day Strain (Stride estimate)
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Today ({date}) · Banister TRIMP, log-mapped to 0–21
          </p>
        </div>
        <Pill tone="muted">Derived · 0–21 scale</Pill>
      </header>

      <Card className="mb-6">
        <div className="p-8">
          <div className="flex items-baseline gap-2">
            <span className="tnum text-6xl font-semibold text-ink-0">
              {value.toFixed(1)}
            </span>
            <span className="text-lg text-ink-3">/ 21</span>
          </div>

          <div className="mt-6">
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-paper-2">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-accent"
                style={{ width: `${pct * 100}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-4 tnum">
              <span>0 · light</span>
              <span>10 · moderate</span>
              <span>21 · all-out</span>
            </div>
          </div>

          {calibrating ? (
            <p className="mt-5 text-sm text-ink-3">
              <Pill tone="warn">Calibrating</Pill>{" "}
              {strain && "reason" in strain
                ? "Not enough heart-rate data yet — wear your device through an active day."
                : "Scaled against a fixed reference until ~14 days of your own TRIMP history exist; the 0–21 mapping will personalise as data accrues."}
            </p>
          ) : (
            <p className="mt-5 text-sm text-ink-3">
              Scaled against the 95th percentile of your own trailing 90-day
              TRIMP, so a high number means &quot;hard relative to you&quot;.
            </p>
          )}
        </div>
      </Card>

      {strain && "trimp" in strain ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          <Card className="p-0">
            <Metric
              label="TRIMP"
              value={strain.trimp.toFixed(0)}
              icon={<Flame className="h-4 w-4" />}
            />
          </Card>
          <Card className="p-0">
            <Metric label="HR minutes" value={strain.minutes.toFixed(0)} />
          </Card>
          <Card className="p-0">
            <Metric label="L = ln(1+TRIMP)" value={strain.l.toFixed(2)} />
          </Card>
          <Card className="p-0">
            <Metric
              label="Calibration days"
              value={strain.historyDays}
              sub={strain.calibrating ? "using fallback ref" : "personal p95"}
            />
          </Card>
        </section>
      ) : null}
    </Shell>
  );
}
