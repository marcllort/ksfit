import { Shell } from "@/components/shell";
import { Card, CardHeader, Empty, Pill } from "@/components/ui";
import { fetchAll } from "@/lib/fetchers";
import { fitbitConnected } from "@/lib/health/fetchers";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { metricRecovery } from "@/lib/health/metrics-fetchers";
import { HeartPulse } from "lucide-react";
import Link from "next/link";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recovery · Stride" };

function todayKey(): string {
  return new Date().toISOString().slice(0, 10);
}

const GATE_COPY: Record<string, string> = {
  "no-hrv-history": "No HRV history yet — wear your device overnight to start collecting.",
  "insufficient-hrv-history": "Needs ~14 nights of HRV. Keep wearing your device overnight.",
  "no-hrv-tonight": "No HRV reading for last night — recovery needs an overnight HRV value.",
};

function bandTone(band: string | null): "good" | "warn" | "bad" | "muted" {
  if (band === "green") return "good";
  if (band === "yellow") return "warn";
  if (band === "red") return "bad";
  return "muted";
}

function NotConnected({ name, avatar }: { name: string; avatar?: string }) {
  return (
    <Shell userName={name} userAvatar={avatar}>
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
          Recovery
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
          Recovery
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
                to see your recovery score.
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

export default async function RecoveryPage() {
  const { user } = await fetchAll();
  if (!(await fitbitConnected())) {
    return <NotConnected name={user.nickname || ""} avatar={user.avatar} />;
  }

  const date = todayKey();
  const rec = await metricRecovery(date);
  const score = rec?.score ?? null;
  const gated = rec?.gatedReason ?? null;

  const components = rec
    ? [
        { label: "HRV", z: rec.components.hrvZ, weight: rec.weights.hrv },
        { label: "Resting HR", z: rec.components.rhrZ, weight: rec.weights.rhr },
        { label: "Breathing", z: rec.components.brZ, weight: rec.weights.br },
        { label: "Sleep", z: rec.components.sleepZ, weight: rec.weights.sleep },
      ]
    : [];

  // Ring geometry.
  const R = 70;
  const C = 2 * Math.PI * R;
  const pct = score != null ? score / 100 : 0;

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            Recovery
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            Recovery (Stride estimate)
          </h1>
          <p className="mt-1 text-sm text-ink-3">
            Today ({date}) · HRV-gated · weights are ours and tunable
          </p>
        </div>
        <Pill tone="muted">Derived · not a medical score</Pill>
      </header>

      <Card className="mb-6">
        <div className="flex flex-col items-center gap-6 p-8 sm:flex-row sm:items-center sm:gap-10">
          <div className="relative h-[180px] w-[180px] shrink-0">
            <svg viewBox="0 0 180 180" className="h-full w-full -rotate-90">
              <circle
                cx="90"
                cy="90"
                r={R}
                fill="none"
                strokeWidth="14"
                className="stroke-paper-2"
              />
              {score != null ? (
                <circle
                  cx="90"
                  cy="90"
                  r={R}
                  fill="none"
                  strokeWidth="14"
                  strokeLinecap="round"
                  strokeDasharray={C}
                  strokeDashoffset={C * (1 - pct)}
                  className={
                    rec?.band === "green"
                      ? "stroke-[color:var(--positive)]"
                      : rec?.band === "yellow"
                        ? "stroke-[color:var(--warn)]"
                        : "stroke-[color:var(--bad)]"
                  }
                />
              ) : null}
            </svg>
            <div className="absolute inset-0 flex flex-col items-center justify-center">
              {score != null ? (
                <>
                  <span className="tnum text-5xl font-semibold text-ink-0">
                    {score}
                  </span>
                  <span className="text-xs uppercase tracking-[0.14em] text-ink-3">
                    of 100
                  </span>
                </>
              ) : (
                <span className="px-4 text-center text-xs text-ink-3">
                  Locked
                </span>
              )}
            </div>
          </div>

          <div className="flex-1">
            {score != null ? (
              <>
                <Pill tone={bandTone(rec?.band ?? null)}>
                  {rec?.band === "green"
                    ? "Recovered"
                    : rec?.band === "yellow"
                      ? "Moderate"
                      : "Low"}
                </Pill>
                <p className="mt-3 text-sm text-ink-2">
                  A blend of last night&apos;s HRV, resting HR, breathing rate and
                  sleep performance, each scored against your own 30-night
                  baseline. 50 = at baseline.
                </p>
              </>
            ) : (
              <>
                <Pill tone="warn">Needs ~14 nights of HRV</Pill>
                <p className="mt-3 text-sm text-ink-2">
                  {gated ? GATE_COPY[gated] : "Recovery is locked until enough HRV history exists."}{" "}
                  Without HRV this isn&apos;t honestly a recovery score, so we
                  withhold it and show the components below.
                </p>
              </>
            )}
          </div>
        </div>
      </Card>

      <Card>
        <CardHeader
          title="Component breakdown"
          hint="Oriented z-scores vs your 30-night baseline (positive = better)"
        />
        <div className="grid grid-cols-2 gap-px overflow-hidden rounded-b-2xl bg-line sm:grid-cols-4">
          {components.map((c) => (
            <div key={c.label} className="bg-paper-1 p-4">
              <div className="flex items-center justify-between text-xs uppercase tracking-[0.12em] text-ink-3">
                <span>{c.label}</span>
                <HeartPulse className="h-3.5 w-3.5 text-ink-4" />
              </div>
              <div
                className={
                  "mt-1 tnum text-2xl font-semibold " +
                  (c.z > 0.05
                    ? "text-[color:var(--positive)]"
                    : c.z < -0.05
                      ? "text-[color:var(--bad)]"
                      : "text-ink-0")
                }
              >
                {c.z >= 0 ? "+" : ""}
                {c.z.toFixed(2)}
              </div>
              <div className="text-xs text-ink-4 tnum">
                weight {(c.weight * 100).toFixed(0)}%
              </div>
            </div>
          ))}
        </div>
      </Card>
    </Shell>
  );
}
