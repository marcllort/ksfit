/**
 * Fitbit routes (ported from apps/web/src/app/api/fitbit/*).
 * OAuth connect/callback/disconnect + activity push, served by the backend.
 */
import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import {
  FITBIT_CLIENT_ID,
  FITBIT_REDIRECT_URI,
  fitbitConfigured,
  exchangeCode,
  generateVerifier,
  challengeFromVerifier,
  randomState,
  NotConnectedError,
  FitbitRateLimitError,
} from "@stride/health-core";
import { tokenStoreForRequest, fitbitForRequest } from "../lib/fitbit/store.ts";
import { loggedSet, rememberLogged } from "../lib/fitbit/logged.ts";
import { requireSession } from "../lib/ksfit/session.ts";
import { fetchSessions } from "../lib/ksfit/fetchers.ts";
import { apiError } from "../lib/errors.ts";

type Env = { Variables: { requestId: string } };
export const fitbitRoutes = new Hono<Env>();

const SCOPES = ["heartrate", "activity", "sleep", "weight", "profile"].join(" ");
const AUTHORIZE_URL = "https://www.fitbit.com/oauth2/authorize";

// Where to send the browser after the OAuth round-trip (the web app's settings).
const APP_ORIGIN = process.env.APP_ORIGIN?.trim() || "http://localhost:3000";

fitbitRoutes.get("/connect", (c) => {
  if (!fitbitConfigured) {
    return apiError(c, "provider_unconfigured", "Fitbit is not configured (set FITBIT_CLIENT_ID).");
  }
  const verifier = generateVerifier();
  const state = randomState();
  setCookie(c, "fitbit_pkce", JSON.stringify({ verifier, state }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 600,
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
  return c.redirect(`${AUTHORIZE_URL}?${params.toString()}`);
});

fitbitRoutes.get("/callback", async (c) => {
  const code = c.req.query("code");
  const state = c.req.query("state");
  const error = c.req.query("error");
  const settings = (status: string) =>
    c.redirect(`${APP_ORIGIN}/settings?fitbit=${status}`);

  if (error) return settings("denied");

  const stash = getCookie(c, "fitbit_pkce");
  setCookie(c, "fitbit_pkce", "", { path: "/", maxAge: 0 });
  if (!code || !state || !stash) return settings("error");

  let verifier = "";
  try {
    const parsed = JSON.parse(stash) as { verifier: string; state: string };
    if (parsed.state !== state) return settings("state_mismatch");
    verifier = parsed.verifier;
  } catch {
    return settings("error");
  }

  try {
    await exchangeCode(await tokenStoreForRequest(c), code, verifier);
    return settings("connected");
  } catch {
    return settings("error");
  }
});

fitbitRoutes.post("/disconnect", async (c) => {
  (await tokenStoreForRequest(c)).clear();
  return c.json({ ok: true });
});

fitbitRoutes.get("/log", (c) => {
  const runId = c.req.query("runId") ?? "";
  const already = loggedSet(c);
  return c.json({ alreadyLogged: runId ? already.has(runId) : false });
});

fitbitRoutes.post("/log", async (c) => {
  if (!fitbitConfigured) {
    return apiError(c, "provider_unconfigured", "Fitbit not configured");
  }
  let runId = "";
  try {
    const body = (await c.req.json()) as { runId?: string };
    runId = body.runId?.trim() ?? "";
  } catch {
    return apiError(c, "invalid_request", "invalid JSON");
  }
  if (!runId) return apiError(c, "invalid_request", "runId required");

  const already = loggedSet(c);
  if (already.has(runId)) return c.json({ ok: true, alreadyLogged: true });

  const session = await requireSession(c);
  const { sessions } = await fetchSessions(session);
  const s = sessions.find((x) => x.runId === runId);
  if (!s) return apiError(c, "not_found", "session not found");

  try {
    const provider = await fitbitForRequest(c);
    const result = await provider.logActivity({
      start: s.startTime,
      durationSec: s.durationSec,
      distanceM: s.distanceM,
      kcal: s.kcal,
      sourceId: runId,
    });
    already.add(runId);
    rememberLogged(c, already);
    return c.json({ ok: true, externalId: result.externalId });
  } catch (e) {
    if (e instanceof NotConnectedError) {
      return apiError(c, "provider_not_connected", "Fitbit not connected");
    }
    if (e instanceof FitbitRateLimitError) {
      return apiError(c, "rate_limited", "Fitbit rate limit — try again later.");
    }
    return apiError(c, "provider_error", "Failed to log to Fitbit.");
  }
});
