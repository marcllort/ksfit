import { LogoTile } from "@/components/logo";

export const dynamic = "force-static";

export const metadata = {
  title: "Offline — Stride",
};

export default function OfflinePage() {
  return (
    <div className="mx-auto flex min-h-dvh max-w-md flex-col items-center justify-center px-6 text-center">
      <LogoTile className="mb-6 h-14 w-14 rounded-2xl" />
      <h1 className="text-2xl font-semibold tracking-tight text-ink-0">
        You’re offline
      </h1>
      <p className="mt-2 text-sm text-ink-3">
        Stride needs network access to talk to KS Fit. Reconnect and reload to
        see fresh data.
      </p>
      {/* A full-page reload is intentional here: this is the offline fallback,
          so "Try again" must actually re-hit the network rather than do a
          client-side nav (which would just render the cached offline page). */}
      {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
      <a
        href="/"
        className="mt-6 inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90"
      >
        Try again
      </a>
    </div>
  );
}
