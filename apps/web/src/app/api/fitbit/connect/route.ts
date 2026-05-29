import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import {
  FITBIT_CLIENT_ID,
  FITBIT_REDIRECT_URI,
  fitbitConfigured,
} from "@/lib/health/fitbit/tokens";
import {
  generateVerifier,
  challengeFromVerifier,
  randomState,
} from "@stride/health-core";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// Scopes for the full two-way integration.
const SCOPES = ["heartrate", "activity", "sleep", "weight", "profile"].join(" ");
const AUTHORIZE_URL = "https://www.fitbit.com/oauth2/authorize";

/**
 * Start the Fitbit OAuth flow: stash a PKCE verifier + state in a short-lived
 * httpOnly cookie and redirect the user to Fitbit's consent screen.
 */
export async function GET() {
  if (!fitbitConfigured) {
    return NextResponse.json(
      { error: "Fitbit is not configured (set FITBIT_CLIENT_ID)." },
      { status: 503 },
    );
  }

  const verifier = generateVerifier();
  const state = randomState();

  const c = await cookies();
  c.set("fitbit_pkce", JSON.stringify({ verifier, state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 600, // 10 min to complete the handshake
  });

  const params = new URLSearchParams({
    client_id: FITBIT_CLIENT_ID,
    response_type: "code",
    code_challenge: challengeFromVerifier(verifier),
    code_challenge_method: "S256",
    scope: SCOPES,
    redirect_uri: FITBIT_REDIRECT_URI,
    state,
  });
  return NextResponse.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
}
