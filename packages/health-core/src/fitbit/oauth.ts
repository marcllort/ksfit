/**
 * Fitbit OAuth — the framework-agnostic parts: config, the token shape, and
 * the over-the-wire code-exchange + refresh calls. PERSISTENCE is not here:
 * where tokens are stored (a cookie today, the encrypted DB in Phase 2) is a
 * host concern, injected via the TokenStore interface below.
 */
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

/** Persistence seam — implemented per host (cookie now, encrypted DB later). */
export interface TokenStore {
  get(): Promise<FitbitTokens | null> | FitbitTokens | null;
  set(t: FitbitTokens): Promise<void> | void;
  clear(): Promise<void> | void;
}

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

/** Exchange an authorization code (PKCE) for the initial token pair + persist. */
export async function exchangeCode(
  store: TokenStore,
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
  });
  if (!res.ok) {
    throw new Error(`Fitbit token exchange failed: ${res.status} ${await res.text()}`);
  }
  const tokens = toTokens((await res.json()) as TokenResponse);
  await store.set(tokens);
  return tokens;
}

/** Refresh the access token (rotates both tokens) and persist. */
export async function refreshTokens(
  store: TokenStore,
  current: FitbitTokens,
): Promise<FitbitTokens> {
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
  });
  if (!res.ok) {
    throw new Error(`Fitbit token refresh failed: ${res.status}`);
  }
  const tokens = toTokens((await res.json()) as TokenResponse);
  await store.set(tokens);
  return tokens;
}

/** Return a valid access token, refreshing if within 60s of expiry. */
export async function getFreshTokens(
  store: TokenStore,
): Promise<FitbitTokens | null> {
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
