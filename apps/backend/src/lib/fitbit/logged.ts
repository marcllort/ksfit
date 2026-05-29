/**
 * Cookie-backed ledger of which source sessions were pushed to Fitbit (dedupe).
 * Phase 2 moves this to the DB. Context-based cookie access (Hono).
 */
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";

const COOKIE = "fitbit_logged";

export function loggedSet(c: Context): Set<string> {
  const raw = getCookie(c, COOKIE);
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export function rememberLogged(c: Context, ids: Set<string>): void {
  const arr = Array.from(ids).slice(-500); // bound cookie size
  setCookie(c, COOKIE, JSON.stringify(arr), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "Lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}
