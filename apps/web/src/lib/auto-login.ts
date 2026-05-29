/**
 * Optional credential-based auto-login for self-hosted single-user installs.
 *
 * When KSFIT_EMAIL / KSFIT_PASSWORD are set (in web/.env.local, gitignored),
 * the app logs in once on the first request, caches the resulting session in
 * process memory, and reuses it for every subsequent request — no login form,
 * no cookie required. On a server restart it simply logs in again from env.
 *
 * This is intended for a private deployment that only you use. Do NOT enable
 * it on any shared/multi-user host: every visitor would see your data.
 */
import { login, type Session } from "@stride/ksfit-client";

const EMAIL = process.env.KSFIT_EMAIL?.trim();
const PASSWORD = process.env.KSFIT_PASSWORD;

/** True when env credentials are present and demo mode is off. */
export const hasAutoLogin =
  process.env.KSFIT_DEMO !== "1" && !!EMAIL && !!PASSWORD;

let cached: Session | null = null;
let inflight: Promise<Session> | null = null;

/**
 * Returns a logged-in Session built from env credentials, or null when
 * auto-login isn't configured. The same Session object is reused across
 * requests, so KS Fit's in-place token rotation (ret=402) keeps it fresh
 * without any persistence layer.
 */
export async function autoSession(): Promise<Session | null> {
  if (!hasAutoLogin) return null;
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const { xjid, token } = await login(EMAIL!, PASSWORD!);
    const s: Session = { xjid, token };
    // Keep the cached token fresh when the upstream rotates it mid-request.
    s.onRotate = (t) => {
      s.token = t;
    };
    cached = s;
    return s;
  })();
  try {
    return await inflight;
  } catch (e) {
    // Don't cache a failed login (e.g. rate-limit); let the next request retry.
    cached = null;
    throw e;
  } finally {
    inflight = null;
  }
}
