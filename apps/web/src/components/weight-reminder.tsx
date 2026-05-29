"use client";
/**
 * In-app weekly weigh-in reminder.
 *
 * Shows a dismissible banner when the most recent weight reading is older than
 * 7 days. Dismissal is remembered for the rest of the day (sessionStorage-free,
 * via a date-stamped localStorage key) so it doesn't nag on every navigation.
 * Web push is a later addition; this is the lightweight in-app nudge.
 */
import * as React from "react";
import { Scale, X } from "lucide-react";

const WEEK_MS = 7 * 86_400_000;

export function WeightReminder({
  latestAtMs,
}: {
  /** Epoch ms of the most recent weight reading, or null when there are none. */
  latestAtMs: number | null;
}) {
  const [dismissed, setDismissed] = React.useState(true);

  React.useEffect(() => {
    if (latestAtMs == null) return;
    const ageMs = Date.now() - latestAtMs;
    if (ageMs <= WEEK_MS) return;
    const key = `stride:weight-reminder:${new Date().toISOString().slice(0, 10)}`;
    if (typeof window !== "undefined" && window.localStorage.getItem(key)) return;
    setDismissed(false);
  }, [latestAtMs]);

  if (dismissed || latestAtMs == null) return null;

  const days = Math.floor((Date.now() - latestAtMs) / 86_400_000);

  function dismiss() {
    const key = `stride:weight-reminder:${new Date().toISOString().slice(0, 10)}`;
    try {
      window.localStorage.setItem(key, "1");
    } catch {
      /* ignore quota / private-mode errors */
    }
    setDismissed(true);
  }

  return (
    <div className="mb-6 flex items-center gap-3 rounded-2xl border border-line bg-paper-2 p-4 text-sm">
      <Scale className="h-5 w-5 shrink-0 text-ink-3" />
      <div className="flex-1 text-ink-2">
        It&apos;s been{" "}
        <span className="font-semibold text-ink-1 tnum">{days} days</span> since
        your last weigh-in. Hop on the scale to keep your trend accurate.
      </div>
      <button
        type="button"
        onClick={dismiss}
        aria-label="Dismiss reminder"
        className="focus-ring shrink-0 rounded-full p-1.5 text-ink-4 transition-colors hover:bg-paper-3 hover:text-ink-1"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
