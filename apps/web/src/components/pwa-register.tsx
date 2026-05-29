"use client";
import { useEffect } from "react";

/**
 * Registers the service worker on mount. Only runs in production builds — the
 * Next.js dev server emits a fresh chunk graph on every save, which makes a
 * persistent SW cache more painful than useful.
 */
export function PwaRegister() {
  useEffect(() => {
    if (typeof window === "undefined") return;
    if (!("serviceWorker" in navigator)) return;
    if (process.env.NODE_ENV !== "production") return;
    navigator.serviceWorker.register("/sw.js", { scope: "/" }).catch(() => {
      // Silent — a failed registration shouldn't surface to the user.
    });
  }, []);
  return null;
}
