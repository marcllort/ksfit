import { NextResponse } from "next/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Liveness probe for the Docker healthcheck / reverse proxy.
 *
 * Intentionally does NOT touch the KS Fit API (that account rate-limits), so
 * it stays cheap and never trips a lockout. The middleware matcher already
 * excludes this path, so it's reachable without a session.
 */
export function GET() {
  return NextResponse.json({ status: "ok" });
}
