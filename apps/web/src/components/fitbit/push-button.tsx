"use client";
import { useState } from "react";
import { Activity, Check } from "lucide-react";
import { cn } from "@/components/ui";

/**
 * "Push to Fitbit" button on the session-detail page. Optimistically reflects
 * the already-logged state passed from the server, and disables itself once a
 * push succeeds (the server also dedupes by run_id).
 */
export function FitbitPushButton({
  runId,
  alreadyLogged,
}: {
  runId: string;
  alreadyLogged: boolean;
}) {
  const [state, setState] = useState<"idle" | "busy" | "done" | "error">(
    alreadyLogged ? "done" : "idle",
  );
  const [msg, setMsg] = useState("");

  async function push() {
    setState("busy");
    setMsg("");
    try {
      const res = await fetch("/api/fitbit/log", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ runId }),
      });
      const data = (await res.json()) as { error?: string };
      if (!res.ok) {
        setState("error");
        setMsg(data.error || "Failed");
        return;
      }
      setState("done");
    } catch {
      setState("error");
      setMsg("Network error");
    }
  }

  const done = state === "done";
  return (
    <button
      onClick={push}
      disabled={state === "busy" || done}
      title={msg}
      className={cn(
        "focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors",
        done
          ? "border-transparent bg-[color:var(--positive)]/10 text-[color:var(--positive)]"
          : state === "error"
            ? "border-[color:var(--bad)] bg-paper-1 text-[color:var(--bad)]"
            : "border-line bg-paper-2 text-ink-1 hover:bg-paper-3",
      )}
    >
      {done ? <Check className="h-4 w-4" /> : <Activity className="h-4 w-4" />}
      {state === "busy"
        ? "Pushing…"
        : done
          ? "On Fitbit"
          : state === "error"
            ? "Retry push"
            : "Push to Fitbit"}
    </button>
  );
}
