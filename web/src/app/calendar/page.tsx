import { Shell } from "@/components/shell";
import { Card, Empty } from "@/components/ui";
import { CalendarClient } from "./client";
import { fetchAll } from "@/lib/fetchers";
import { groupByDay } from "@/lib/data";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calendar · Stride" };

export default async function CalendarPage() {
  const { user, sessions } = await fetchAll();

  // Flatten day buckets to a serializable shape for the client.
  const buckets = groupByDay(sessions);
  const days: { date: string; durationSec: number; distanceM: number; sessions: number; kcal: number }[] = [];
  for (const [k, b] of buckets) {
    days.push({
      date: k,
      durationSec: b.durationSec,
      distanceM: b.distanceM,
      sessions: b.sessions.length,
      kcal: b.kcal,
    });
  }
  days.sort((a, b) => a.date.localeCompare(b.date));

  const firstDate = days[0]?.date ?? null;
  const lastDate = days[days.length - 1]?.date ?? null;

  return (
    <Shell userName={user.nickname || ""} userAvatar={user.avatar}>
      <header className="mb-6">
        <p className="text-sm font-medium uppercase tracking-[0.14em] text-ink-3">
          Calendar
        </p>
        <h1 className="mt-2 text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
          Month view
        </h1>
        {firstDate && lastDate ? (
          <p className="mt-1 text-sm text-ink-3">
            Activity recorded between {firstDate} and {lastDate}
          </p>
        ) : null}
      </header>

      {days.length === 0 ? (
        <Card><div className="p-8"><Empty>No sessions yet.</Empty></div></Card>
      ) : (
        <CalendarClient days={days} startDate={firstDate!} endDate={lastDate!} />
      )}
    </Shell>
  );
}
