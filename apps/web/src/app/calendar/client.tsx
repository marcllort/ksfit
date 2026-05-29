"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";
import { Card, Pill } from "@/components/ui";
import { fmtDate } from "@stride/ksfit-client/data";

export interface DayDatum {
  date: string;
  durationSec: number;
  distanceM: number;
  sessions: number;
  kcal: number;
}

const DOW = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

export function CalendarClient({
  days,
  startDate,
  endDate,
}: {
  days: DayDatum[];
  startDate: string;
  endDate: string;
}) {
  const map = useMemo(() => new Map(days.map((d) => [d.date, d])), [days]);

  // Start the view on the latest month with activity.
  const initial = new Date(endDate + "T00:00:00Z");
  const [cursor, setCursor] = useState({
    year: initial.getUTCFullYear(),
    month: initial.getUTCMonth(),
  });

  const monthStart = new Date(Date.UTC(cursor.year, cursor.month, 1));
  const monthEnd = new Date(Date.UTC(cursor.year, cursor.month + 1, 0));
  const firstDow = (monthStart.getUTCDay() + 6) % 7; // Mon=0

  // Build a flat 6×7 grid (always 42 cells).
  const cells: ({ date: string; data?: DayDatum } | null)[] = [];
  for (let i = 0; i < firstDow; i++) cells.push(null);
  for (let d = 1; d <= monthEnd.getUTCDate(); d++) {
    const key = `${cursor.year}-${String(cursor.month + 1).padStart(2, "0")}-${String(d).padStart(2, "0")}`;
    cells.push({ date: key, data: map.get(key) });
  }
  while (cells.length < 42) cells.push(null);

  // Per-month totals
  const monthTotals = cells.reduce(
    (a, c) => {
      if (!c?.data) return a;
      return {
        d: a.d + c.data.distanceM,
        t: a.t + c.data.durationSec,
        n: a.n + c.data.sessions,
        k: a.k + c.data.kcal,
        days: a.days + 1,
      };
    },
    { d: 0, t: 0, n: 0, k: 0, days: 0 },
  );

  // Scale colour by minutes within this month so a quiet month still shows shape.
  const maxMin = Math.max(
    1,
    ...cells.map((c) => (c?.data ? c.data.durationSec / 60 : 0)),
  );

  const minDate = new Date(startDate + "T00:00:00Z");
  const maxDate = new Date(endDate + "T00:00:00Z");
  const atStart =
    cursor.year < minDate.getUTCFullYear() ||
    (cursor.year === minDate.getUTCFullYear() &&
      cursor.month <= minDate.getUTCMonth());
  const atEnd =
    cursor.year > maxDate.getUTCFullYear() ||
    (cursor.year === maxDate.getUTCFullYear() &&
      cursor.month >= maxDate.getUTCMonth());

  function shift(delta: number) {
    const d = new Date(Date.UTC(cursor.year, cursor.month + delta, 1));
    setCursor({ year: d.getUTCFullYear(), month: d.getUTCMonth() });
  }

  return (
    <Card>
      <div className="flex flex-wrap items-center justify-between gap-3 p-5 pb-3">
        <div className="flex items-center gap-3">
          <button
            onClick={() => shift(-1)}
            disabled={atStart}
            aria-label="Previous month"
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper-1 text-ink-2 transition-colors hover:bg-paper-2 disabled:opacity-40"
          >
            <ChevronLeft className="h-4 w-4" />
          </button>
          <h2 className="text-xl font-semibold tracking-tight text-ink-0">
            {fmtDate(monthStart, {
              month: "long",
              year: "numeric",
            })}
          </h2>
          <button
            onClick={() => shift(1)}
            disabled={atEnd}
            aria-label="Next month"
            className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper-1 text-ink-2 transition-colors hover:bg-paper-2 disabled:opacity-40"
          >
            <ChevronRight className="h-4 w-4" />
          </button>
        </div>
        <div className="flex flex-wrap gap-2 text-xs text-ink-3">
          <Pill tone="muted">{monthTotals.days} active days</Pill>
          <Pill tone="muted">{(monthTotals.d / 1000).toFixed(1)} km</Pill>
          <Pill tone="muted">
            {Math.round(monthTotals.t / 60)} min
          </Pill>
          <Pill tone="muted">{monthTotals.n} sessions</Pill>
        </div>
      </div>

      <div className="grid grid-cols-7 gap-1.5 px-5 pb-2 text-[11px] uppercase tracking-wider text-ink-4">
        {DOW.map((d) => (
          <div key={d} className="px-1 py-1">
            {d}
          </div>
        ))}
      </div>

      <div className="grid grid-cols-7 gap-1.5 px-5 pb-5">
        {cells.map((c, i) => {
          if (!c) {
            return (
              <div
                key={`pad-${i}`}
                className="aspect-square rounded-xl bg-transparent"
              />
            );
          }
          const min = c.data ? c.data.durationSec / 60 : 0;
          const intensity = min / maxMin;
          const day = parseInt(c.date.slice(-2), 10);
          return (
            <Link
              key={c.date}
              href={`/day/${c.date}`}
              className="group relative aspect-square overflow-hidden rounded-xl border border-line bg-paper-1 p-2 text-left transition-colors hover:border-accent"
              style={
                c.data
                  ? ({
                      backgroundImage: `linear-gradient(to top, var(--accent-soft) ${
                        20 + intensity * 70
                      }%, transparent 100%)`,
                    } as React.CSSProperties)
                  : undefined
              }
            >
              <div className="flex items-start justify-between">
                <span className="tnum text-sm font-semibold text-ink-1">
                  {day}
                </span>
                {c.data ? (
                  <span className="tnum text-[10px] font-medium text-ink-3">
                    {c.data.sessions}×
                  </span>
                ) : null}
              </div>
              {c.data ? (
                <div className="absolute inset-x-2 bottom-2">
                  <div className="tnum text-xs font-semibold text-ink-0">
                    {(c.data.distanceM / 1000).toFixed(1)}
                    <span className="ml-0.5 text-[10px] text-ink-3">km</span>
                  </div>
                  <div className="tnum text-[10px] text-ink-3">
                    {Math.round(c.data.durationSec / 60)} min
                  </div>
                </div>
              ) : null}
            </Link>
          );
        })}
      </div>
    </Card>
  );
}
