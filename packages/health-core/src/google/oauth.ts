/**
 * Google Health OAuth — the framework-agnostic parts: config, the token shape,
 * and the over-the-wire code-exchange + refresh calls. PERSISTENCE is not here:
 * where tokens are stored (a cookie today, the encrypted DB in Phase 2) is a
 * host concern, injected via the GoogleTokenStore interface below.
 *
 * Mirrors fitbit/oauth.ts. The Google Health API is the successor to the legacy
 * Fitbit Web API (https://developers.google.com/health) and uses Google's
 * standard OAuth 2.0 framework (https://developers.google.com/health/get-started).
 * Tokens are NOT transferable from Fitbit — Google Health requires separate
 * user consent against the googlehealth.* scopes.
 *
 * OAuth 2.0 endpoints (Google standard):
 *   auth:  https://accounts.google.com/o/oauth2/v2/auth
 *   token: https://oauth2.googleapis.com/token
 * Scopes verified at https://developers.google.com/health/scopes
 */
const TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";

export const GOOGLE_HEALTH_CLIENT_ID =
  process.env.GOOGLE_HEALTH_CLIENT_ID?.trim() || "";
export const GOOGLE_HEALTH_CLIENT_SECRET =
  process.env.GOOGLE_HEALTH_CLIENT_SECRET?.trim() || "";
export const GOOGLE_HEALTH_REDIRECT_URI =
  process.env.GOOGLE_HEALTH_REDIRECT_URI?.trim() ||
  "http://localhost:3000/api/google-health/callback";

/**
 * True when the app is configured to talk to Google Health at all. Until the
 * user registers a Google OAuth app (sets GOOGLE_HEALTH_CLIENT_ID), the provider
 * stays inert — isConnected() returns false and every read fails soft. This is
 * the "fail cleanly when unconfigured" contract: the provider is code-complete
 * but dormant until configured.
 */
export const googleHealthConfigured = !!GOOGLE_HEALTH_CLIENT_ID;

/**
 * OAuth 2.0 scopes the provider requests. Read-only across the bundles that map
 * to our domain signals. Verified at https://developers.google.com/health/scopes
 *   - activity_and_fitness: steps, distance, calories, active minutes, exercise,
 *     VO2max / cardio fitness, heart-rate zones.
 *   - health_metrics_and_measurements: heart rate, resting HR, HRV, SpO2,
 *     respiratory rate, sleep-temperature derivations, weight, body fat, height.
 *   - sleep: sleep sessions + stages.
 *   - profile: user profile (age/sex/height/weight).
 * We do NOT request the *.writeonly scopes: write (logActivity) is not yet
 * exposed by the API (see provider.logActivity).
 */
export const GOOGLE_HEALTH_SCOPES = [
  "https://www.googleapis.com/auth/googlehealth.activity_and_fitness.readonly",
  "https://www.googleapis.com/auth/googlehealth.health_metrics_and_measurements.readonly",
  "https://www.googleapis.com/auth/googlehealth.sleep.readonly",
  "https://www.googleapis.com/auth/googlehealth.profile.readonly",
] as const;

export interface GoogleHealthTokens {
  accessToken: string;
  refreshToken: string;
  /** Unix epoch ms when the access token expires. */
  expiresAt: number;
  /**
   * Google Health addresses the authed user as "me" in resource names
   * (users/me/...), so unlike Fitbit there is no per-user id in the token
   * response. Kept for parity with FitbitTokens; defaults to "me".
   */
  userId: string;
  scope: string;
}

/** Persistence seam — implemented per host (cookie now, encrypted DB later). */
export interface GoogleTokenStore {
  get(): Promise<GoogleHealthTokens | null> | GoogleHealthTokens | null;
  set(t: GoogleHealthTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

/**
 * Google's token response. Note: `refresh_token` is only returned on the FIRST
 * authorization (with access_type=offline & prompt=consent) — subsequent
 * refreshes do NOT rotate it, so we carry the existing one forward.
 */
type TokenResponse = {
  access_token: string;
  refresh_token?: string;
  expires_in: number;
  scope: string;
  token_type: string;
};

function toTokens(
  r: TokenResponse,
  previousRefresh?: string,
): GoogleHealthTokens {
  const refreshToken = r.refresh_token ?? previousRefresh ?? "";
  return {
    accessToken: r.access_token,
    refreshToken,
    expiresAt: Date.now() + r.expires_in * 1000,
    userId: "me",
    scope: r.scope,
  };
}

/** Exchange an authorization code (PKCE) for the initial token pair + persist. */
export async function exchangeCode(
  store: GoogleTokenStore,
  code: string,
  codeVerifier: string,
): Promise<GoogleHealthTokens> {
  const body = new URLSearchParams({
    client_id: GOOGLE_HEALTH_CLIENT_ID,
    // Google is a confidential client when a secret is configured; PKCE is still
    // sent. The secret is optional for "installed app" style clients.
    ...(GOOGLE_HEALTH_CLIENT_SECRET
      ? { client_secret: GOOGLE_HEALTH_CLIENT_SECRET }
      : {}),
    grant_type: "authorization_code",
    redirect_uri: GOOGLE_HEALTH_REDIRECT_URI,
    code,
    code_verifier: codeVerifier,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(
      `Google Health token exchange failed: ${res.status} ${await res.text()}`,
    );
  }
  const tokens = toTokens((await res.json()) as TokenResponse);
  await store.set(tokens);
  return tokens;
}

/**
 * Refresh the access token and persist. Google does NOT rotate the refresh
 * token on refresh, so the prior one is carried forward by toTokens().
 */
export async function refreshTokens(
  store: GoogleTokenStore,
  current: GoogleHealthTokens,
): Promise<GoogleHealthTokens> {
  const body = new URLSearchParams({
    client_id: GOOGLE_HEALTH_CLIENT_ID,
    ...(GOOGLE_HEALTH_CLIENT_SECRET
      ? { client_secret: GOOGLE_HEALTH_CLIENT_SECRET }
      : {}),
    grant_type: "refresh_token",
    refresh_token: current.refreshToken,
  });
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    throw new Error(`Google Health token refresh failed: ${res.status}`);
  }
  const tokens = toTokens(
    (await res.json()) as TokenResponse,
    current.refreshToken,
  );
  await store.set(tokens);
  return tokens;
}

/** Return a valid access token, refreshing if within 60s of expiry. */
export async function getFreshTokens(
  store: GoogleTokenStore,
): Promise<GoogleHealthTokens | null> {
  const t = await store.get();
  if (!t) return null;
  if (Date.now() >= t.expiresAt - 60_000) {
    try {
      return await refreshTokens(store, t);
    } catch {
      return null;
    }
  }
  return t;
}
