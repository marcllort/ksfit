/**
 * KS Fit session resolution for the backend.
 *
 * Ported from apps/web/src/lib/session.ts, but cookie access is via the Hono
 * context (getCookie/setCookie) instead of next/headers — so the same logic
 * serves web (cookie transport) and, later, iOS. The env auto-login path needs
 * no cookie at all.
 */
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { Session } from "@stride/ksfit-client";
import { autoSession } from "./auto-login.ts";
import { ApiError } from "../errors.ts";

const COOKIE = "ksfit_session";

export function setSessionCookie(c: Context, s: Session): void {
  setCookie(c, COOKIE, JSON.stringify({ xjid: s.xjid, token: s.token }), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 90,
  });
}

export function clearSessionCookie(c: Context): void {
  setCookie(c, COOKIE, "", { path: "/", maxAge: 0 });
}

export function getSessionFromCookie(c: Context): Session | null {
  const raw = getCookie(c, COOKIE);
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (!s.xjid || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

/**
 * Resolve the KS Fit session for this request: a cookie session if present,
 * else env auto-login. Throws ApiError(unauthenticated) when neither is
 * available (the backend never redirects — that's a client concern).
 */
export async function requireSession(c: Context): Promise<Session> {
  const fromCookie = getSessionFromCookie(c);
  if (fromCookie) {
    ensureRotationPersist(c, fromCookie);
    return fromCookie;
  }
  const auto = await autoSession();
  if (auto) return auto; // auto-login brings its own in-memory onRotate
  throw new ApiError("unauthenticated", "No KS Fit session.");
}

/**
 * Persist a rotated token (ret=402) back to the cookie. The auto-login Session
 * already has an in-memory onRotate, so we never clobber it.
 */
export function ensureRotationPersist(c: Context, session: Session): void {
  if (session.onRotate) return;
  session.onRotate = (token) => {
    session.token = token;
    setSessionCookie(c, { xjid: session.xjid, token });
  };
}
