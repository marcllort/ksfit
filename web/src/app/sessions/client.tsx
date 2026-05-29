"use client";
import Link from "next/link";
import { useMemo, useState } from "react";
import { ArrowRight, Footprints, Search, SlidersHorizontal } from "lucide-react";
import { Card, Pill } from "@/components/ui";
import { Dropdown } from "@/components/dropdown";
import { fmtDate, fmtDateTime, fmtTime } from "@/lib/data";

export interface FlatSession {
  runId: string;
  startTime: string; // ISO
  durationSec: number;
  distanceM: number;
  steps: number;
  kcal: number;
  model: string;
  isAppleWatch: boolean;
  courseName: string;
}

type SortKey = "date" | "distance" | "duration" | "kcal";

const RANGES = [
  { key: "all", label: "All time" },
  { key: "30", label: "30 days" },
  { key: "90", label: "90 days" },
  { key: "365", label: "1 year" },
] as const;
type RangeKey = (typeof RANGES)[number]["key"];

function fmtKm(m: number) {
  return (m / 1000).toFixed(2);
}
function fmtDur(sec: number) {
  const h = Math.floor(sec / 3600);
  const m = Math.floor((sec % 3600) / 60);
  if (h) return `${h}h ${String(m).padStart(2, "0")}m`;
  const s = sec % 60;
  return `${m}m ${String(s).padStart(2, "0")}s`;
}
function fmtSpeed(durSec: number, distM: number) {
  if (durSec === 0) return "—";
  return ((distM / 1000) / (durSec / 3600)).toFixed(2);
}
function fmtSteps(n: number) {
  return n.toLocaleString();
}

type Tag = "all" | "watch" | "course";

export function SessionsClient({ sessions }: { sessions: FlatSession[] }) {
  const [q, setQ] = useState("");
  const [range, setRange] = useState<RangeKey>("all");
  const [sort, setSort] = useState<SortKey>("date");
  const [tag, setTag] = useState<Tag>("all");
  const [model, setModel] = useState<string>("all");

  // Distinct device models present in the data, for the device chips.
  const models = useMemo(
    () => Array.from(new Set(sessions.map((s) => s.model).filter(Boolean))).sort(),
    [sessions],
  );

  const filtered = useMemo(() => {
    const now = Date.now();
    const cutoff =
      range === "all"
        ? 0
        : now - parseInt(range, 10) * 86_400_000;
    const needle = q.trim().toLowerCase();
    return sessions.filter((s) => {
      if (new Date(s.startTime).getTime() < cutoff) return false;
      if (tag === "watch" && !s.isAppleWatch) return false;
      if (tag === "course" && !s.courseName) return false;
      if (model !== "all" && s.model !== model) return false;
      if (!needle) return true;
      const dateStr = new Date(s.startTime)
        .toLocaleString("en-US")
        .toLowerCase();
      return (
        dateStr.includes(needle) ||
        s.model.toLowerCase().includes(needle) ||
        s.courseName.toLowerCase().includes(needle)
      );
    });
  }, [sessions, q, range, tag, model]);

  const sorted = useMemo(() => {
    const arr = [...filtered];
    switch (sort) {
      case "distance":
        arr.sort((a, b) => b.distanceM - a.distanceM);
        break;
      case "duration":
        arr.sort((a, b) => b.durationSec - a.durationSec);
        break;
      case "kcal":
        arr.sort((a, b) => b.kcal - a.kcal);
        break;
      default:
        arr.sort(
          (a, b) =>
            new Date(b.startTime).getTime() - new Date(a.startTime).getTime(),
        );
    }
    return arr;
  }, [filtered, sort]);

  // Group by day for date-sorted view.
  const grouped = useMemo(() => {
    if (sort !== "date") return null;
    const m = new Map<string, FlatSession[]>();
    for (const s of sorted) {
      const k = s.startTime.slice(0, 10);
      const arr = m.get(k) ?? [];
      arr.push(s);
      m.set(k, arr);
    }
    return Array.from(m.entries());
  }, [sorted, sort]);

  return (
    <>
      <Card className="mb-4 p-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="relative min-w-[180px] flex-1">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-ink-3" />
            <input
              type="search"
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Search by date or model…"
              className="focus-ring h-10 w-full rounded-full border border-line bg-paper-1 pl-9 pr-3 text-sm text-ink-1 outline-none placeholder:text-ink-4 transition-colors"
            />
          </div>
          <div className="flex gap-1 rounded-full border border-line bg-paper-1 p-1">
            {RANGES.map((r) => (
              <button
                key={r.key}
                onClick={() => setRange(r.key)}
                className={`focus-ring rounded-full px-3 py-1 text-xs font-medium transition-colors ${
                  range === r.key
                    ? "bg-ink-0 text-paper-0"
                    : "text-ink-3 hover:text-ink-1"
                }`}
              >
                {r.label}
              </button>
            ))}
          </div>
          <div className="flex items-center gap-1.5 text-ink-3">
            <SlidersHorizontal className="h-4 w-4" />
            <Dropdown<SortKey>
              label="Sort"
              value={sort}
              onChange={setSort}
              options={[
                { value: "date", label: "Newest first" },
                { value: "distance", label: "Longest distance" },
                { value: "duration", label: "Longest time" },
                { value: "kcal", label: "Highest kcal" },
              ]}
            />
          </div>
        </div>
      </Card>

      {/* Quick filters */}
      {(models.length > 1 || sessions.some((s) => s.isAppleWatch || s.courseName)) ? (
        <div className="mb-3 flex flex-wrap gap-1.5">
          <Chip active={tag === "all" && model === "all"} onClick={() => { setTag("all"); setModel("all"); }}>
            All
          </Chip>
          {sessions.some((s) => s.isAppleWatch) ? (
            <Chip active={tag === "watch"} onClick={() => setTag(tag === "watch" ? "all" : "watch")}>
              Apple Watch
            </Chip>
          ) : null}
          {sessions.some((s) => s.courseName) ? (
            <Chip active={tag === "course"} onClick={() => setTag(tag === "course" ? "all" : "course")}>
              Has course
            </Chip>
          ) : null}
          {models.length > 1
            ? models.map((m) => (
                <Chip key={m} active={model === m} onClick={() => setModel(model === m ? "all" : m)}>
                  {m}
                </Chip>
              ))
            : null}
        </div>
      ) : null}

      <p className="mb-3 text-xs text-ink-3 tnum">
        {sorted.length.toLocaleString("en-US")} session{sorted.length === 1 ? "" : "s"}
      </p>

      {sorted.length === 0 ? (
        <Card className="grid place-items-center py-16 text-center text-sm text-ink-3">
          No sessions match this filter.
        </Card>
      ) : grouped ? (
        <div className="space-y-6">
          {grouped.map(([day, items]) => {
            const totals = items.reduce(
              (a, s) => ({
                d: a.d + s.distanceM,
                t: a.t + s.durationSec,
                k: a.k + s.kcal,
                steps: a.steps + s.steps,
              }),
              { d: 0, t: 0, k: 0, steps: 0 },
            );
            return (
              <div key={day}>
                <div className="mb-2 flex items-baseline justify-between px-1">
                  <Link
                    href={`/day/${day}`}
                    className="text-sm font-semibold tracking-tight text-ink-0 hover:underline"
                  >
                    {fmtDate(new Date(day + "T00:00:00Z"), {
                      weekday: "long",
                      month: "long",
                      day: "numeric",
                      year: "numeric",
                    }, "en-US")}
                  </Link>
                  <span className="text-xs text-ink-3 tnum">
                    {items.length}× · <span className="text-accent">{fmtSteps(totals.steps)} steps</span>{" "}
                    · {fmtKm(totals.d)} km · {fmtDur(totals.t)}
                  </span>
                </div>
                <Card className="overflow-hidden">
                  <div className="divide-y divide-line">
                    {items.map((s) => (
                      <SessionRow key={s.runId} s={s} />
                    ))}
                  </div>
                </Card>
              </div>
            );
          })}
        </div>
      ) : (
        <Card className="overflow-hidden">
          <div className="divide-y divide-line">
            {sorted.map((s) => (
              <SessionRow key={s.runId} s={s} showDate />
            ))}
          </div>
        </Card>
      )}
    </>
  );
}

function SessionRow({ s, showDate }: { s: FlatSession; showDate?: boolean }) {
  const dt = new Date(s.startTime);
  return (
    <Link
      href={`/sessions/${s.runId}`}
      className="group grid grid-cols-[auto_1fr_auto] items-center gap-3 px-4 py-3.5 transition-colors hover:bg-paper-2 sm:px-5"
    >
      <div className="grid h-10 w-10 place-items-center rounded-full bg-paper-2 text-ink-3 group-hover:bg-accent group-hover:text-accent-fg transition-colors">
        <Footprints className="h-4 w-4" />
      </div>
      <div className="min-w-0">
        <div className="truncate text-sm font-semibold text-ink-1">
          {showDate
            ? fmtDateTime(dt, {
                weekday: "short",
                month: "short",
                day: "numeric",
                hour: "numeric",
                minute: "2-digit",
              })
            : fmtTime(dt, {
                hour: "numeric",
                minute: "2-digit",
              })}
        </div>
        <div className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3 tnum">
          <span>{s.model}</span>
          <span>·</span>
          <span>{fmtSpeed(s.durationSec, s.distanceM)} km/h</span>
          {s.isAppleWatch ? (
            <Pill tone="muted" className="ml-1 px-1.5 py-0">
              Apple Watch
            </Pill>
          ) : null}
          {s.courseName ? <Pill tone="muted" className="ml-1 px-1.5 py-0">{s.courseName}</Pill> : null}
        </div>
      </div>
      <div className="flex items-center gap-4 sm:gap-5 lg:gap-6">
        <Stat label="steps" v={fmtSteps(s.steps)} emphasis />
        <Stat label="km" v={fmtKm(s.distanceM)} />
        <Stat label="time" v={fmtDur(s.durationSec)} className="hidden md:block" />
        <Stat label="kcal" v={Math.round(s.kcal).toString()} className="hidden lg:block" />
        <ArrowRight className="hidden h-4 w-4 shrink-0 text-ink-4 group-hover:text-ink-1 sm:block" />
      </div>
    </Link>
  );
}

function Stat({
  label,
  v,
  className,
  emphasis,
}: {
  label: string;
  v: string;
  className?: string;
  emphasis?: boolean;
}) {
  return (
    <div className={`text-right ${className ?? ""}`}>
      <div
        className={`tnum font-semibold text-ink-0 ${
          emphasis ? "text-base" : "text-sm"
        }`}
      >
        {v}
      </div>
      <div
        className={`text-[10px] uppercase tracking-wider ${
          emphasis ? "text-accent" : "text-ink-4"
        }`}
      >
        {label}
      </div>
    </div>
  );
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      onClick={onClick}
      aria-pressed={active}
      className={`focus-ring rounded-full border px-3 py-1 text-xs font-medium transition-colors ${
        active
          ? "border-transparent bg-ink-0 text-paper-0"
          : "border-line bg-paper-1 text-ink-3 hover:text-ink-1"
      }`}
    >
      {children}
    </button>
  );
}
