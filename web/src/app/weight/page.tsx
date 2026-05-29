import { Shell } from "@/components/shell";
import { Card, CardHeader, Metric, Empty, Pill } from "@/components/ui";
import { AreaTrend } from "@/components/charts/trend";
import { fetchAll } from "@/lib/fetchers";
import { fmtDate, fmtDateTime } from "@/lib/data";
import { TrendingDown, TrendingUp, Scale, Activity } from "lucide-react";

export const dynamic = "force-dynamic";
export const metadata = { title: "Weight · Stride" };

export default async function WeightPage() {
  const { user, weights } = await fetchAll();

  const sorted = [...weights].sort((a, b) => a.at.getTime() - b.at.getTime());
  const latest = sorted[sorted.length - 1];
  const earliest = sorted[0];
  const minW = sorted.reduce((m, w) => (w.weight < m ? w.weight : m), Infinity);
  const maxW = sorted.reduce((m, w) => (w.weight > m ? w.weight : m), 0);
  const delta = latest && earliest ? latest.weight - earliest.weight : 0;
  const userHeightM = Number(user.height) / 100;

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
          Body
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
          Weight & BMI
        </h1>
      </header>

      {weights.length === 0 ? (
        <Card>
          <div className="p-8">
            <Empty>
              No weight entries yet. Log weight in the KS Fit app — it&apos;ll
              show up here.
            </Empty>
          </div>
        </Card>
      ) : (
        <>
          <section className="mb-6 grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
            <Card className="p-0">
              <Metric
                label="Latest"
                value={latest.weight.toFixed(1)}
                unit="kg"
                icon={<Scale className="h-4 w-4" />}
                sub={`BMI ${latest.bmi.toFixed(1)}`}
              />
            </Card>
            <Card className="p-0">
              <Metric
                label="Change"
                value={
                  <span
                    className={
                      delta < 0
                        ? "text-[color:var(--positive)]"
                        : delta > 0
                          ? "text-[color:var(--warn)]"
                          : ""
                    }
                  >
                    {delta > 0 ? "+" : ""}
                    {delta.toFixed(1)}
                  </span>
                }
                unit="kg"
                icon={
                  delta < 0 ? (
                    <TrendingDown className="h-4 w-4" />
                  ) : (
                    <TrendingUp className="h-4 w-4" />
                  )
                }
                sub={`since ${fmtDate(earliest.at, {})}`}
              />
            </Card>
            <Card className="p-0">
              <Metric
                label="Range"
                value={`${minW.toFixed(1)}–${maxW.toFixed(1)}`}
                unit="kg"
                icon={<Activity className="h-4 w-4" />}
                sub={`${(maxW - minW).toFixed(1)} kg spread`}
              />
            </Card>
            <Card className="p-0">
              <Metric
                label="Entries"
                value={weights.length.toString()}
                sub={`Height: ${(userHeightM * 100).toFixed(0)} cm`}
              />
            </Card>
          </section>

          <Card className="mb-6">
            <CardHeader
              title="Weight trend"
              hint={`From ${fmtDate(earliest.at, {})} to ${fmtDate(latest.at, {})}`}
              action={<Pill tone="muted">kg</Pill>}
            />
            <div className="px-2 pb-3">
              <AreaTrend
                data={sorted.map((w) => ({
                  label: w.at.toISOString().slice(5, 10),
                  value: Number(w.weight.toFixed(1)),
                }))}
                height={260}
                unit="kg"
              />
            </div>
          </Card>

          <Card>
            <CardHeader title="Entries" hint={`${weights.length} total`} />
            <div className="divide-y divide-line">
              {sorted
                .slice()
                .reverse()
                .map((w) => {
                  const cls = bmiClass(w.bmi);
                  return (
                    <div
                      key={w.id}
                      className="grid grid-cols-[1fr_auto_auto] items-center gap-3 px-5 py-3.5"
                    >
                      <div>
                        <div className="text-sm font-medium text-ink-1">
                          {fmtDateTime(w.at, {
                            weekday: "short",
                            year: "numeric",
                            month: "short",
                            day: "numeric",
                            hour: "numeric",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                      <Pill tone={cls.tone}>BMI {w.bmi.toFixed(1)} · {cls.label}</Pill>
                      <div className="tnum text-right text-base font-semibold text-ink-0">
                        {w.weight.toFixed(1)}
                        <span className="ml-1 text-xs font-normal text-ink-3">
                          kg
                        </span>
                      </div>
                    </div>
                  );
                })}
            </div>
          </Card>
        </>
      )}
    </Shell>
  );
}

function bmiClass(b: number): {
  label: string;
  tone: "good" | "warn" | "bad" | "muted";
} {
  if (b < 18.5) return { label: "Under", tone: "warn" };
  if (b < 25) return { label: "Normal", tone: "good" };
  if (b < 30) return { label: "Over", tone: "warn" };
  return { label: "Obese", tone: "bad" };
}
