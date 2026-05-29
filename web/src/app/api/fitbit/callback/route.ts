import { NextResponse, type NextRequest } from "next/server";
import { cookies } from "next/headers";
import { exchangeCode } from "@/lib/health/fitbit/tokens";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Fitbit OAuth callback: validate state, exchange the code (with the stashed
 * PKCE verifier) for tokens, then redirect back into the app.
 */
export async function GET(req: NextRequest) {
  const url = req.nextUrl;
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  const settingsUrl = new URL("/settings", url.origin);

  if (error) {
    settingsUrl.searchParams.set("fitbit", "denied");
    return NextResponse.redirect(settingsUrl);
  }

  const c = await cookies();
  const stash = c.get("fitbit_pkce")?.value;
  c.delete("fitbit_pkce");

  if (!code || !state || !stash) {
    settingsUrl.searchParams.set("fitbit", "error");
    return NextResponse.redirect(settingsUrl);
  }

  let verifier = "";
  try {
    const parsed = JSON.parse(stash) as { verifier: string; state: string };
    if (parsed.state !== state) {
      settingsUrl.searchParams.set("fitbit", "state_mismatch");
      return NextResponse.redirect(settingsUrl);
    }
    verifier = parsed.verifier;
  } catch {
    settingsUrl.searchParams.set("fitbit", "error");
    return NextResponse.redirect(settingsUrl);
  }

  try {
    await exchangeCode(code, verifier);
    settingsUrl.searchParams.set("fitbit", "connected");
  } catch {
    settingsUrl.searchParams.set("fitbit", "error");
  }
  return NextResponse.redirect(settingsUrl);
}
