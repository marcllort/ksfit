"use client";
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Loader2, RefreshCw } from "lucide-react";
import { refreshAll } from "@/app/actions";

/**
 * Forces a re-fetch from KS Fit. Useful right after finishing a workout: the
 * 60-second sport-records TTL may not have expired yet, so the new entry
 * wouldn't appear on its own.
 */
export function RefreshButton({ className }: { className?: string }) {
  const [pending, start] = useTransition();
  const [tickedAt, setTickedAt] = useState<number | null>(null);
  const router = useRouter();

  return (
    <button
      onClick={() =>
        start(async () => {
          await refreshAll();
          setTickedAt(Date.now());
          router.refresh();
        })
      }
      disabled={pending}
      className={`focus-ring inline-flex h-9 items-center gap-2 rounded-full border border-line bg-paper-1 px-3.5 text-xs font-medium text-ink-2 transition-colors hover:bg-paper-2 disabled:opacity-50 ${className ?? ""}`}
      title={
        tickedAt
          ? `Last refreshed at ${new Date(tickedAt).toLocaleTimeString()}`
          : "Re-fetch fresh data from KS Fit"
      }
    >
      {pending ? (
        <Loader2 className="h-3.5 w-3.5 animate-spin" />
      ) : (
        <RefreshCw className="h-3.5 w-3.5" />
      )}
      {pending ? "Refreshing…" : "Refresh"}
    </button>
  );
}
