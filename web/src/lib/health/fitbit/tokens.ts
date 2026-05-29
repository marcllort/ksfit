/**
 * Fitbit OAuth token storage + refresh.
 *
 * Tokens live in a single httpOnly cookie (same approach as the KS Fit
 * session). Access tokens last 8h; we refresh opportunistically when within a
 * minute of expiry or on a 401. Refresh rotates BOTH tokens, so we persist the
 * new pair every time.
 *
 * Config comes from env (web/.env.local):
 *   FITBIT_CLIENT_ID, FITBIT_CLIENT_SECRET (secret optional for PKCE),
 *   FITBIT_REDIRECT_URI (must exactly match the app's registered callback).
 */
import { cookies } from "next/headers";

const COOKIE = "fitbit_tokens";
const TOKEN_URL = "https://api.fitbit.com/oauth2/token";

export const FITBIT_CLIENT_ID = process.env.FITBIT_CLIENT_ID?.trim() || "";
export const FITBIT_CLIENT_SECRET =
  process.env.FITBIT_CLIENT_SECRET?.trim() || "";
export const FITBIT_REDIRECT_URI =
  process.env.FITBIT_REDIRECT_URI?.trim() ||
  "http://localhost:3000/api/fitbit/callback";

/** True when the app is configured to talk to Fitbit at all. */
export const fitbitConfigured = !!FITBIT_CLIENT_ID;

export interface FitbitTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch ms when the access token expires. */
  expiresAt: number;
  userId: string;
  scope: string;
}

export async function getTokens(): Promise<FitbitTokens | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const t = JSON.parse(raw) as FitbitTokens;
    if (!t.accessToken || !t.refreshToken) return null;
    return t;
  } catch {
    return null;
  }
}

export async function setTokens(t: FitbitTokens): Promise<void> {
  const c = await cookies();
  c.set(COOKIE, JSON.stringify(t), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365, // refresh token is long-lived; re-auth if lost
  });
}

export async function clearTokens(): Promise<void> {
  (await cookies()).delete(COOKIE);
}

/** Basic-auth header used for confidential (Server) apps; omitted for PKCE. */
function basicAuthHeader(): Record<string, string> {
  if (!FITBIT_CLIENT_SECRET) return {};
  const b64 = Buffer.from(
    `${FITBIT_CLIENT_ID}:${FITBIT_CLIENT_SECRET}`,
  ).toString("base64");
  return { Authorization: `Basic ${b64}` };
}

type TokenResponse = {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  user_id: string;
  scope: string;
};

function toTokens(r: TokenResponse): FitbitTokens {
  return {
    accessToken: r.access_token,
    refreshToken: r.refresh_token,
    expiresAt: Date.now() + r.expires_in * 1000,
    userId: r.user_id,
    scope: r.scope,
  };
}

/** Exchange an authorization code (PKCE) for the initial token pair. */
export async function exchangeCode(
  code: string,
  codeVerifier: string,
): Promise<FitbitTokens> {
  const body = new URLSearchParams({
    client_id: FITBIT_CLIENT_ID,
    grant_type: "authorization_code",
    redirect_uri: FITBIT_REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...basicAuthHeader(),
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Fitbit token exchange failed: ${res.status} ${await res.text()}`);
  }
  const tokens = toTokens((await res.json()) as TokenResponse);
  await setTokens(tokens);
  return tokens;
}

/** Refresh the access token (rotates both tokens) and persist. */
export async function refreshTokens(current: FitbitTokens): Promise<FitbitTokens> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
    client_id: FITBIT_CLIENT_ID,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      ...basicAuthHeader(),
    },
    body,
    cache: "no-store",
  });
  if (!res.ok) {
    throw new Error(`Fitbit token refresh failed: ${res.status}`);
  }
  const tokens = toTokens((await res.json()) as TokenResponse);
  await setTokens(tokens);
  return tokens;
}

/** Return a valid access token, refreshing if it's within 60s of expiry. */
export async function getFreshTokens(): Promise<FitbitTokens | null> {
  const t = await getTokens();
  if (!t) return null;
  if (Date.now() >= t.expiresAt - 60_000) {
    try {
      return await refreshTokens(t);
    } catch {
      return null; // refresh failed → treat as disconnected
    }
  }
  return t;
}
