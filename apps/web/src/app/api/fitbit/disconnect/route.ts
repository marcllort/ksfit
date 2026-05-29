import { NextResponse } from "next/server";
import { webTokenStore } from "@/lib/health/fitbit/web-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forget the stored Fitbit tokens (local only; doesn't revoke at Fitbit). */
export async function POST() {
  (await webTokenStore()).clear();
  return NextResponse.json({ ok: true });
}
