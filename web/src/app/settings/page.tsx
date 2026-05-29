import { Suspense } from "react";
import { Shell } from "@/components/shell";
import { Card, CardHeader } from "@/components/ui";
import { SettingCard } from "@/components/settings/setting-card";
import { FitbitConnectCard } from "@/components/fitbit/connect-card";
import { fetchAll } from "@/lib/fetchers";
import { fmtDate } from "@/lib/data";
import { SETTINGS, type SettingId } from "@/lib/settings/definitions";
import { getAllSettings } from "@/lib/settings/server";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { fitbitProvider } from "@/lib/health/fitbit/provider";
import { HardDrive } from "lucide-react";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [{ user, devices }, values] = await Promise.all([
    fetchAll(),
    getAllSettings(),
  ]);
  const ids = Object.keys(SETTINGS) as SettingId[];
  const boundDevices = devices?.list ?? [];
  const fitbitConnected = fitbitConfigured
    ? await fitbitProvider().isConnected()
    : false;

  return (
    <Shell userName={user.nickname || "Athlete"} userAvatar={user.avatar}>
      <section className="mb-6 animate-rise">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
          Settings
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
          Tune your dashboard
        </h1>
        <p className="mt-1 text-sm text-ink-3">
          Preferences live in a cookie scoped to this browser — they ride with
          your session and reset when you clear site data. Nothing is synced
          back to KS Fit.
        </p>
      </section>

      <section className="mb-8">
        <Suspense fallback={null}>
          <FitbitConnectCard
            configured={fitbitConfigured}
            connected={fitbitConnected}
          />
        </Suspense>
      </section>

      <section className="space-y-4">
        {ids.map((id) => (
          <SettingCard key={id} id={id} saved={values[id]} />
        ))}
      </section>

      {boundDevices.length > 0 ? (
        <section className="mt-8">
          <Card>
            <CardHeader
              title="Your devices"
              hint={`${boundDevices.length} bound to your account`}
            />
            <div className="divide-y divide-line">
              {boundDevices.map((d) => (
                <div
                  key={d.did}
                  className="flex items-center gap-3 px-5 py-3.5"
                >
                  <div className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-paper-2 text-ink-3">
                    <HardDrive className="h-4 w-4" />
                  </div>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-sm font-medium text-ink-1">
                      {d.name || d.model}
                    </div>
                    <div className="truncate text-xs text-ink-3">
                      {d.model}
                      {d.bind_time
                        ? ` · bound ${fmtDate(new Date(d.bind_time.replace(" ", "T") + "Z"), { dateStyle: "medium" })}`
                        : ""}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </section>
      ) : null}
    </Shell>
  );
}
