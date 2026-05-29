/**
 * Cookie-backed Fitbit TokenStore for the backend (Hono context).
 * Phase 2 swaps this for an encrypted DB-backed store — same interface.
 */
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { FitbitTokens, TokenStore } from "@stride/health-core";
import { FitbitProvider } from "@stride/health-core";

const COOKIE = "fitbit_tokens";

export function cookieTokenStore(c: Context): TokenStore {
  return {
    get(): FitbitTokens | null {
      const raw = getCookie(c, COOKIE);
      if (!raw) return null;
      try {
        const t = JSON.parse(raw) as FitbitTokens;
        if (!t.accessToken || !t.refreshToken) return null;
        return t;
      } catch {
        return null;
      }
    },
    set(t: FitbitTokens): void {
      setCookie(c, COOKIE, JSON.stringify(t), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "Lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    },
    clear(): void {
      setCookie(c, COOKIE, "", { path: "/", maxAge: 0 });
    },
  };
}

/** A FitbitProvider bound to the request's cookie token store. */
export function fitbitForRequest(c: Context): FitbitProvider {
  return new FitbitProvider(cookieTokenStore(c));
}
