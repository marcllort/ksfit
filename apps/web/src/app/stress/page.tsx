import { Shell } from "@/components/shell";
import { Card, Empty, Pill, Metric } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { metricStress } from "@/lib/health/metrics-fetchers";
import { Gauge } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Stress · Stride" };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

function bucketTone(b: string): "good" | "warn" | "bad" {
  return b === "low" ? "good" : b === "medium" ? "warn" : "bad";
}

export default async function StressPage() {
  const { user } = await fetchAll();
  if (!(await fitbitConnected())) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Stress
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Stress
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
                  to see your stress estimate.
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
  const stress = await metricStress(date);
  const index = stress?.index ?? 0;
  const bucket = stress?.bucket ?? "low";
  const calibrating = stress?.calibrating ?? true;
  const pct = Math.min(1, index / 100);

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Stress
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Stress (HR-based estimate)
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Today ({date}) · {stress?.label ?? "Stress (HR-based estimate)"}
          </p>
        </div>
        <Pill tone={bucketTone(bucket)}>{bucket}</Pill>
      </header>

      <Card className="mb-6">
        <div className="p-8">
          <p className="text-sm text-ink-3">
            This is an <strong className="text-ink-1">estimate of physiological
            arousal</strong> from heart-rate elevation over resting — not an
            EDA/Stress-Management score and not an emotional or clinical
            measure. Neither the Fitbit nor Google Health API exposes a real
            stress score, so this is fully self-derived.
          </p>

          <div className="mt-6 flex items-baseline gap-2">
            <span className="tnum text-6xl font-semibold text-ink-0">
              {index.toFixed(0)}
            </span>
            <span className="text-lg text-ink-3">/ 100 index</span>
          </div>

          <div className="mt-6">
            <div className="relative h-3 w-full overflow-hidden rounded-full bg-paper-2">
              <div
                className={
                  "absolute inset-y-0 left-0 rounded-full " +
                  (bucket === "low"
                    ? "bg-[color:var(--positive)]"
                    : bucket === "medium"
                      ? "bg-[color:var(--warn)]"
                      : "bg-[color:var(--bad)]")
                }
                style={{ width: `${pct * 100}%` }}
              />
            </div>
            <div className="mt-2 flex justify-between text-xs text-ink-4 tnum">
              <span>0 · calm</span>
              <span>50</span>
              <span>100 · elevated</span>
            </div>
          </div>

          {calibrating ? (
            <p className="mt-5 text-sm text-ink-3">
              <Pill tone="warn">Calibrating</Pill> Buckets use fixed cuts until
              ~30 days of your own history exist; they&apos;ll switch to your
              personal terciles after that.
            </p>
          ) : (
            <p className="mt-5 text-sm text-ink-3">
              Bucketed against your own trailing 30-day terciles.
            </p>
          )}
        </div>
      </Card>

      {stress && "elevatedPct" in stress ? (
        <section className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-3">
          <Card className="p-0">
            <Metric
              label="Elevated minutes"
              value={`${stress.elevatedPct.toFixed(0)}%`}
              icon={<Gauge className="h-4 w-4" />}
              sub="above arousal threshold"
            />
          </Card>
          <Card className="p-0">
            <Metric label="Counted minutes" value={stress.minutes.toFixed(0)} sub="coverage proxy" />
          </Card>
          <Card className="p-0">
            <Metric label="Bucket" value={bucket} sub={calibrating ? "fixed cuts" : "personal terciles"} />
          </Card>
        </section>
      ) : null}
    </Shell>
  );
}
