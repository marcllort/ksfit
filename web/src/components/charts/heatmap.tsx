"use client";
/**
 * GitHub-style activity heatmap. The grid is week-major (column = ISO week,
 * row = day of week) so newer weeks land on the right.
 */
import Link from "next/link";
import { useMemo, useState } from "react";

export interface HeatCell {
  date: string; // YYYY-MM-DD
  value: number;
  label?: string;
}

interface Props {
  cells: HeatCell[]; // chronological, oldest first
  unit?: string;
}

/** Pick a colour stop from the --heat-0..5 ramp. */
function heatColor(v: number, max: number): string {
  if (v <= 0 || max <= 0) return "var(--heat-0)";
  const ratio = Math.min(1, v / max);
  if (ratio < 0.2) return "var(--heat-1)";
  if (ratio < 0.4) return "var(--heat-2)";
  if (ratio < 0.65) return "var(--heat-3)";
  if (ratio < 0.85) return "var(--heat-4)";
  return "var(--heat-5)";
}

// Cell size constants — kept here (not Tailwind classes) because they're
// shared between the cell grid AND the month-label grid above it; the
// alignment between the two columns depends on identical sizing.
const CELL = 14; // px — including the right side of the gap
const GAP = 3;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export function Heatmap({ cells, unit = "min" }: Props) {
  const max = useMemo(() => Math.max(0, ...cells.map((c) => c.value)), [cells]);
  const [hover, setHover] = useState<HeatCell | null>(null);

  // Bucket cells into weeks (col) × dow (row, Mon=0). The first column is
  // padded with empty days so the start of the range aligns to a weekday.
  const weeks = useMemo(() => {
    if (cells.length === 0) return [] as (HeatCell | null)[][];
    const out: (HeatCell | null)[][] = [];
    const first = new Date(cells[0].date + "T00:00:00Z");
    const firstDow = (first.getUTCDay() + 6) % 7; // Mon=0
    let col: (HeatCell | null)[] = Array(firstDow).fill(null);
    for (const c of cells) {
      col.push(c);
      if (col.length === 7) {
        out.push(col);
        col = [];
      }
    }
    if (col.length) {
      while (col.length < 7) col.push(null);
      out.push(col);
    }
    return out;
  }, [cells]);

  const monthLabels = useMemo(() => {
    const labels: { col: number; label: string }[] = [];
    let lastMonth = -1;
    weeks.forEach((wk, i) => {
      const c = wk.find((x) => x !== null) as HeatCell | undefined;
      if (!c) return;
      const m = new Date(c.date + "T00:00:00Z").getUTCMonth();
      if (m !== lastMonth) {
        labels.push({ col: i, label: MONTHS[m] });
        lastMonth = m;
      }
    });
    return labels;
  }, [weeks]);

  // Each cell+gap takes `CELL` px (12px cell + 3px gap minus 1 for the last).
  // Tracks are fixed-width so cells don't stretch when the parent is wider
  // than the natural content size.
  const gridStyle: React.CSSProperties = {
    display: "grid",
    gridAutoFlow: "column",
    gap: GAP,
    gridAutoColumns: `${CELL - GAP}px`,
  };

  return (
    // overflow-y: visible is the load-bearing rule: the parent only manages
    // horizontal scroll. Without it, browsers default the unspecified axis
    // to `auto`, which flickers a vertical scrollbar whenever the inner
    // container momentarily measures taller (e.g. during hover transitions).
    <div className="relative">
      <div
        className="overflow-x-auto"
        style={{ overflowY: "visible", scrollbarGutter: "stable" }}
      >
        {/* Inline-block + content sizing means cells stay 12px regardless of
            how wide the card is. */}
        <div className="inline-block pb-1">
          {/* Month-axis row */}
          <div
            style={{ ...gridStyle, gridTemplateRows: "1fr", height: 16 }}
            className="mb-1"
          >
            {weeks.map((_, i) => {
              const m = monthLabels.find((x) => x.col === i);
              return (
                <div
                  key={`mo-${i}`}
                  className="text-[10px] uppercase tracking-wider text-ink-4"
                >
                  {m?.label ?? ""}
                </div>
              );
            })}
          </div>
          {/* 7×N cell grid */}
          <div
            style={{
              ...gridStyle,
              gridTemplateRows: `repeat(7, ${CELL - GAP}px)`,
            }}
          >
            {weeks.flatMap((week, ci) =>
              week.map((cell, ri) =>
                cell ? (
                  <Link
                    href={`/day/${cell.date}`}
                    key={`${ci}-${ri}`}
                    onMouseEnter={() => setHover(cell)}
                    onMouseLeave={() => setHover(null)}
                    style={{ backgroundColor: heatColor(cell.value, max) }}
                    className="block rounded-[3px] outline-none ring-1 ring-inset ring-[color:var(--line)] transition-shadow hover:shadow-[0_0_0_2px_var(--accent)] focus-visible:shadow-[0_0_0_2px_var(--accent)]"
                    aria-label={`${cell.date}: ${cell.value} ${unit}`}
                  />
                ) : (
                  <div key={`${ci}-${ri}`} />
                ),
              ),
            )}
          </div>
        </div>
      </div>

      {/* Legend — hover read-out leads on the left, scale on the right. */}
      <div className="mt-3 flex items-center justify-between gap-3 text-[11px] text-ink-3 tnum">
        <span className="min-h-[1em]">
          {hover ? (
            <span className="hidden text-ink-2 sm:inline">
              {hover.date} ·{" "}
              <strong className="text-ink-0">{hover.value}</strong> {unit}
            </span>
          ) : null}
        </span>
        <div className="flex items-center gap-2">
          <span className="tnum text-ink-3">0 {unit}</span>
          <div className="flex gap-[3px]">
            {([0, 1, 2, 3, 4, 5] as const).map((i) => (
              <div
                key={i}
                className="h-3 w-3 rounded-[3px] ring-1 ring-inset ring-[color:var(--line)]"
                style={{ backgroundColor: `var(--heat-${i})` }}
              />
            ))}
          </div>
          <span className="tnum text-ink-3">
            {max > 0 ? `${max} ${unit}` : `— ${unit}`}
          </span>
        </div>
      </div>
    </div>
  );
}
