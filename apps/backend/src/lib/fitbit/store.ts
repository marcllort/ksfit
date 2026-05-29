/**
 * Fitbit TokenStore selection for the backend.
 *
 * When TOKEN_ENC_KEY is set (production / self-hosted), tokens live in the
 * encrypted DB keyed by the user resolved from the KS Fit session — the raw
 * Fitbit JWT never reaches the browser. Without it (dev convenience), we fall
 * back to the httpOnly cookie store. Both satisfy the same TokenStore seam.
 */
import type { Context } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import type { FitbitTokens, TokenStore } from "@stride/health-core";
import { FitbitProvider } from "@stride/health-core";
import { dbTokenCustody } from "../db.ts";
import { dbTokenStore, userIdForXjid } from "./db-store.ts";
import { requireSession } from "../ksfit/session.ts";

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

/**
 * The TokenStore for this request: encrypted DB (keyed by the session user)
 * when custody is on, else the cookie store. Async because resolving the user
 * may trigger env auto-login.
 */
export async function tokenStoreForRequest(c: Context): Promise<TokenStore> {
  if (dbTokenCustody) {
    const session = await requireSession(c);
    return dbTokenStore(userIdForXjid(session.xjid));
  }
  return cookieTokenStore(c);
}

/** A FitbitProvider bound to this request's token store. */
export async function fitbitForRequest(c: Context): Promise<FitbitProvider> {
  return new FitbitProvider(await tokenStoreForRequest(c));
}
