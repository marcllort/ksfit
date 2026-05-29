import { NextResponse } from "next/server";
import { clearTokens } from "@/lib/health/fitbit/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Forget the stored Fitbit tokens (local only; doesn't revoke at Fitbit). */
export async function POST() {
  await clearTokens();
  return NextResponse.json({ ok: true });
}
