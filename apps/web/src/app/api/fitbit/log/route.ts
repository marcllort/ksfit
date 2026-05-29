import { NextResponse } from "next/server";
import { requireSession } from "@/lib/session";
import { fetchSessions } from "@/lib/fetchers";
import { fitbitProvider, FitbitRateLimitError } from "@/lib/health/fitbit/provider";
import { fitbitConfigured } from "@/lib/health/fitbit/tokens";
import { loggedSet, rememberLogged } from "@/lib/health/fitbit/logged";
import { NotConnectedError } from "@stride/health-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Push one WalkingPad session to Fitbit as a Walking activity log. */
export async function POST(req: Request) {
  if (!fitbitConfigured) {
    return NextResponse.json({ error: "Fitbit not configured" }, { status: 503 });
  }

  let runId = "";
  try {
    const body = (await req.json()) as { runId?: string };
    runId = body.runId?.trim() ?? "";
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!runId) {
    return NextResponse.json({ error: "runId required" }, { status: 400 });
  }

  const already = await loggedSet();
  if (already.has(runId)) {
    return NextResponse.json({ ok: true, alreadyLogged: true });
  }

  const session = await requireSession();
  const { sessions } = await fetchSessions(session);
  const s = sessions.find((x) => x.runId === runId);
  if (!s) {
    return NextResponse.json({ error: "session not found" }, { status: 404 });
  }

  try {
    const result = await fitbitProvider().logActivity({
      start: s.startTime,
      durationSec: s.durationSec,
      distanceM: s.distanceM,
      kcal: s.kcal,
      sourceId: runId,
    });
    already.add(runId);
    await rememberLogged(already);
    return NextResponse.json({ ok: true, externalId: result.externalId });
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return NextResponse.json({ error: "Fitbit not connected" }, { status: 401 });
    }
    if (e instanceof FitbitRateLimitError) {
      return NextResponse.json(
        { error: "Fitbit rate limit — try again later." },
        { status: 429 },
      );
    }
    return NextResponse.json({ error: "Failed to log to Fitbit." }, { status: 500 });
  }
}

/** GET ?runId=... → whether this session was already pushed (for button state). */
export async function GET(req: Request) {
  const url = new URL(req.url);
  const runId = url.searchParams.get("runId") ?? "";
  const already = await loggedSet();
  return NextResponse.json({ alreadyLogged: runId ? already.has(runId) : false });
}
