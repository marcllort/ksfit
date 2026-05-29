"use client";
import { useEffect } from "react";
import { RefreshCw, AlertTriangle, Clock } from "lucide-react";
import { LogoTile } from "@/components/logo";
import { Button } from "@/components/ui";

/**
 * Route error boundary. Distinguishes KS Fit rate-limiting (code 141, which
 * locks the account's IP for ~15-30 min — retrying immediately makes it worse)
 * from transient errors, and gives a friendly retry rather than Next's overlay.
 * Auth failures are handled upstream by requireSession redirecting to /login.
 */
export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  const msg = error.message || "";
  const rateLimited = /\b141\b/.test(msg) || /rate.?limit|too many/i.test(msg);

  return (
    <div className="mx-auto flex min-h-[70dvh] max-w-md flex-col items-center justify-center px-6 text-center">
      <LogoTile className="mb-6 h-14 w-14 rounded-2xl" />
      <div className="mb-3 grid h-12 w-12 place-items-center rounded-full bg-paper-2 text-ink-3">
        {rateLimited ? (
          <Clock className="h-6 w-6" />
        ) : (
          <AlertTriangle className="h-6 w-6" />
        )}
      </div>
      <h1 className="text-xl font-semibold tracking-tight text-ink-0">
        {rateLimited ? "KS Fit is rate-limiting us" : "Something went wrong"}
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        {rateLimited
          ? "KS Fit temporarily blocks an IP after several rapid requests. Wait 15–30 minutes before retrying — hammering it will extend the lockout."
          : "Couldn't load your data from KS Fit. This is usually transient — try again in a moment."}
      </p>
      <Button className="mt-6" onClick={() => reset()}>
        <RefreshCw className="h-4 w-4" />
        Try again
      </Button>
    </div>
  );
}
