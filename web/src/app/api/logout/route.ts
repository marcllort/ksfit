import { NextResponse } from "next/server";
import { clearSession, getSession } from "@/lib/session";
import { invalidateUser } from "@/lib/cache";

export async function POST() {
  // Wipe both the cookie AND the in-process cache so the next visitor on
  // this Node process doesn't inherit our cached responses.
  const s = await getSession();
  if (s) invalidateUser(s.xjid);
  await clearSession();
  return NextResponse.json({ ok: true });
}
