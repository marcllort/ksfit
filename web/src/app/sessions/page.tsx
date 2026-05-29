import { Shell } from "@/components/shell";
import { Card } from "@/components/ui";
import { ExportButton } from "@/components/export-button";
import { SessionsClient } from "./client";
import { fetchAll } from "@/lib/fetchers";
import { fmtKm, fmtDuration, fmtKcal, fmtSteps } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Sessions · Stride" };

export default async function SessionsPage() {
  const { user, sessions } = await fetchAll();

  // Aggregate lifetime stats for the header strip.
  const lifetime = {
    count: sessions.length,
    distanceKm: sessions.reduce((a, s) => a + s.distanceM, 0) / 1000,
    durationSec: sessions.reduce((a, s) => a + s.durationSec, 0),
    steps: sessions.reduce((a, s) => a + s.steps, 0),
    kcal: sessions.reduce((a, s) => a + s.kcal, 0),
  };

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6 flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
            History
          </p>
          <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
            All sessions
          </h1>
        </div>
        <ExportButton href="/api/export/sessions.csv" label="Export CSV" />
      </header>

      <Card className="mb-6">
        <div className="grid grid-cols-2 divide-y divide-line sm:grid-cols-5 sm:divide-x sm:divide-y-0">
          {[
            ["Sessions", lifetime.count.toLocaleString()],
            ["Distance", `${fmtKm(lifetime.distanceKm * 1000, 1)} km`],
            ["Time", fmtDuration(lifetime.durationSec)],
            ["Steps", fmtSteps(lifetime.steps)],
            ["kcal", fmtKcal(lifetime.kcal)],
          ].map(([k, v]) => (
            <div key={k} className="p-5">
              <div className="text-xs uppercase tracking-[0.12em] text-ink-3">
                {k}
              </div>
              <div className="mt-1 tnum text-xl font-semibold text-ink-0">{v}</div>
            </div>
          ))}
        </div>
      </Card>

      <SessionsClient
        sessions={sessions.map((s) => ({
          runId: s.runId,
          startTime: s.startTime.toISOString(),
          durationSec: s.durationSec,
          distanceM: s.distanceM,
          steps: s.steps,
          kcal: s.kcal,
          model: s.model,
          isAppleWatch: s.isAppleWatch,
          courseName: s.courseName,
        }))}
      />
    </Shell>
  );
}
