import { Shell } from "@/components/shell";
import { SettingCard } from "@/components/settings/setting-card";
import { fetchAll } from "@/lib/fetchers";
import { SETTINGS, type SettingId } from "@/lib/settings/definitions";
import { getAllSettings } from "@/lib/settings/server";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const [{ user }, values] = await Promise.all([
    fetchAll(),
    getAllSettings(),
  ]);
  const ids = Object.keys(SETTINGS) as SettingId[];

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

      <section className="space-y-4">
        {ids.map((id) => (
          <SettingCard key={id} id={id} saved={values[id]} />
        ))}
      </section>
    </Shell>
  );
}
