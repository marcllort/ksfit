import { Shell } from "@/components/shell";
import { Card, CardHeader, Empty, Pill, Metric } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { metricHrvTrend } from "@/lib/health/metrics-fetchers";
import { Activity, TrendingDown, TrendingUp, Minus } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "HRV · Stride" };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function HrvPage() {
  const { user } = await fetchAll();
  if (!(await fitbitConnected())) {
    return (
      <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
        <header className="mb-6">
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            HRV
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Heart-rate variability
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
                  to see your HRV baseline.
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
  const hrv = await metricHrvTrend(date);

  const TrendIcon =
    hrv?.trend === "rising"
      ? TrendingUp
      : hrv?.trend === "falling"
        ? TrendingDown
        : Minus;
  const trendTone: "good" | "bad" | "muted" =
    hrv?.trend === "rising" ? "good" : hrv?.trend === "falling" ? "bad" : "muted";

  const statusTone: "good" | "warn" | "muted" =
    hrv?.status === "above"
      ? "good"
      : hrv?.status === "below"
        ? "warn"
        : "muted";

  // Band gauge geometry (latest position within low..high, padded).
  const low = hrv?.low ?? null;
  const high = hrv?.high ?? null;
  const latest = hrv?.latest ?? null;
  let markerPct: number | null = null;
  if (low != null && high != null && latest != null && high > low) {
    const span = high - low;
    const padded = (latest - (low - span)) / (span * 3); // low-span .. high+span
    markerPct = Math.max(0, Math.min(1, padded));
  }

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            HRV
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Heart-rate variability
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            RMSSD · {date} · your target is the band, not a single number
          </p>
        </div>
        <Pill tone={trendTone}>
          <TrendIcon className="mr-1 h-3.5 w-3.5" />
          {hrv?.trend ?? "flat"}
        </Pill>
      </header>

      {hrv && !hrv.sufficient ? (
        <Card className="mb-6">
          <div className="p-5 text-sm text-ink-2">
            <Pill tone="warn">Needs ~14 nights of HRV</Pill>{" "}
            Only {hrv.nights} usable night{hrv.nights === 1 ? "" : "s"} so far.
            The baseline and target band firm up once you have ~14.
          </div>
        </Card>
      ) : null}

      <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
        <Card className="p-0">
          <Metric
            label="Latest"
            value={latest != null ? latest.toFixed(0) : "—"}
            unit={latest != null ? "ms" : undefined}
            icon={<Activity className="h-4 w-4" />}
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Baseline"
            value={hrv?.baseline != null ? hrv.baseline.toFixed(0) : "—"}
            unit={hrv?.baseline != null ? "ms" : undefined}
            sub="30-night EWMA"
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Target band"
            value={
              low != null && high != null
                ? `${low.toFixed(0)}–${high.toFixed(0)}`
                : "—"
            }
            unit={low != null ? "ms" : undefined}
            sub="±0.75σ · where you should be"
          />
        </Card>
        <Card className="p-0">
          <Metric
            label="Status"
            value={hrv?.status ?? "—"}
            sub={`${hrv?.nights ?? 0} nights`}
          />
        </Card>
      </section>

      {markerPct != null && low != null && high != null ? (
        <Card>
          <CardHeader
            title="Where you sit"
            hint="Latest reading against your personal target band"
          />
          <div className="px-6 pb-8 pt-2">
            <div className="relative h-3 w-full rounded-full bg-paper-2">
              {/* target band region (middle third) */}
              <div className="absolute inset-y-0 left-1/3 w-1/3 rounded-full bg-[color:var(--positive)]/25" />
              {/* marker */}
              <div
                className="absolute -top-1.5 h-6 w-1.5 -translate-x-1/2 rounded-full bg-ink-0"
                style={{ left: `${markerPct * 100}%` }}
              />
            </div>
            <div className="mt-3 flex justify-between text-xs text-ink-4 tnum">
              <span>below</span>
              <span>
                {low.toFixed(0)}–{high.toFixed(0)} ms band
              </span>
              <span>above</span>
            </div>
            <p className="mt-4 text-sm text-ink-3">
              <Pill tone={statusTone}>{hrv?.status ?? "—"}</Pill>{" "}
              {hrv?.status === "within"
                ? "You're within your normal range — a good sign your system is balanced."
                : hrv?.status === "above"
                  ? "Above your band — often well-rested, sometimes a sign of fatigue if sustained."
                  : "Below your band — commonly tied to stress, illness, alcohol or under-recovery."}
            </p>
          </div>
        </Card>
      ) : null}
    </Shell>
  );
}
