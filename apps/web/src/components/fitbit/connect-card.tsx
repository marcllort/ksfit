"use client";
import { useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Activity, Plug, Unplug } from "lucide-react";
import { Card, CardHeader, Button } from "@/components/ui";

/**
 * Settings card to connect/disconnect Fitbit. Connecting is a full-page nav to
 * the OAuth start route; disconnecting POSTs to clear the stored tokens.
 */
export function FitbitConnectCard({
  configured,
  connected,
}: {
  configured: boolean;
  connected: boolean;
}) {
  const router = useRouter();
  const params = useSearchParams();
  const status = params.get("fitbit");
  const [busy, setBusy] = useState(false);

  async function disconnect() {
    setBusy(true);
    await fetch("/api/fitbit/disconnect", { method: "POST" });
    router.refresh();
    setBusy(false);
  }

  return (
    <Card>
      <CardHeader
        title="Fitbit"
        hint={
          connected
            ? "Connected — heart rate, sleep & activity are available"
            : "Connect to pull heart rate, sleep, and activity, and push your walks"
        }
        action={
          <span className="grid h-9 w-9 place-items-center rounded-full bg-paper-2 text-ink-3">
            <Activity className="h-4 w-4" />
          </span>
        }
      />
      <div className="px-5 pb-5">
        {!configured ? (
          <p className="text-sm text-ink-3">
            Fitbit isn&apos;t configured yet. Add <code className="text-ink-1">FITBIT_CLIENT_ID</code>{" "}
            (and optionally <code className="text-ink-1">FITBIT_CLIENT_SECRET</code>) to{" "}
            <code className="text-ink-1">web/.env.local</code> — see{" "}
            <code className="text-ink-1">docs/FITBIT.md</code>.
          </p>
        ) : connected ? (
          <div className="flex items-center justify-between gap-3">
            <span className="inline-flex items-center gap-2 text-sm text-[color:var(--positive)]">
              <span className="h-2 w-2 rounded-full bg-[color:var(--positive)]" />
              Connected
            </span>
            <Button variant="secondary" onClick={disconnect} disabled={busy}>
              <Unplug className="h-4 w-4" />
              {busy ? "Disconnecting…" : "Disconnect"}
            </Button>
          </div>
        ) : (
          <div className="flex flex-col gap-3">
            {status === "denied" ? (
              <p className="text-sm text-[color:var(--warn)]">
                Authorization was cancelled. Try again when ready.
              </p>
            ) : status && status !== "connected" ? (
              <p className="text-sm text-[color:var(--bad)]">
                Something went wrong connecting to Fitbit. Please retry.
              </p>
            ) : null}
            <a href="/api/fitbit/connect" className="self-start">
              <Button>
                <Plug className="h-4 w-4" />
                Connect Fitbit
              </Button>
            </a>
          </div>
        )}
      </div>
    </Card>
  );
}
