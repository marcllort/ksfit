/**
 * Credential-based auto-login for the single-user self-hosted install.
 *
 * Ported from apps/web/src/lib/auto-login.ts — unchanged semantics: log in once
 * from KSFIT_EMAIL/KSFIT_PASSWORD, cache the Session in process memory, reuse it
 * across requests (KS Fit's in-place ret=402 rotation keeps the token fresh).
 */
import { login, type Session } from "@stride/ksfit-client";

const EMAIL = process.env.KSFIT_EMAIL?.trim();
const PASSWORD = process.env.KSFIT_PASSWORD;

export const hasAutoLogin =
  process.env.KSFIT_DEMO !== "1" && !!EMAIL && !!PASSWORD;

let cached: Session | null = null;
let inflight: Promise<Session> | null = null;

export async function autoSession(): Promise<Session | null> {
  if (!hasAutoLogin) return null;
  if (cached) return cached;
  if (inflight) return inflight;
  inflight = (async () => {
    const { xjid, token } = await login(EMAIL!, PASSWORD!);
    const s: Session = { xjid, token };
    s.onRotate = (t) => {
      s.token = t;
    };
    cached = s;
    return s;
  })();
  try {
    return await inflight;
  } catch (e) {
    cached = null; // don't cache a failed login (e.g. rate-limit)
    throw e;
  } finally {
    inflight = null;
  }
}
