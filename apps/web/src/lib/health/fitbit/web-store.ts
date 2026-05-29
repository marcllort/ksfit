/**
 * Web (Next.js) cookie-backed Fitbit TokenStore + provider factory.
 *
 * Mirrors the backend's store but uses next/headers cookies. Lets the web app's
 * existing server routes/pages keep working against the FitbitProvider that now
 * lives in @stride/health-core, until they're rewired to call the backend.
 */
import { cookies } from "next/headers";
import {
  FitbitProvider,
  type FitbitTokens,
  type TokenStore,
} from "@stride/health-core";

const COOKIE = "fitbit_tokens";

export async function webTokenStore(): Promise<TokenStore> {
  const jar = await cookies();
  return {
    get(): FitbitTokens | null {
      const raw = jar.get(COOKIE)?.value;
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
      jar.set(COOKIE, JSON.stringify(t), {
        httpOnly: true,
        secure: process.env.NODE_ENV === "production",
        sameSite: "lax",
        path: "/",
        maxAge: 60 * 60 * 24 * 365,
      });
    },
    clear(): void {
      jar.delete(COOKIE);
    },
  };
}

/** Build a FitbitProvider bound to the current request's cookies. */
export async function fitbitProvider(): Promise<FitbitProvider> {
  return new FitbitProvider(await webTokenStore());
}
