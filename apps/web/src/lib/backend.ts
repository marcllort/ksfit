/**
 * Thin server-side client for the Stride backend API.
 *
 * Web server components / route handlers call the backend over HTTP instead of
 * computing health data in-process. This is the seam that makes the web app a
 * pure client of the same API the iOS app will use. The browser session cookie
 * is forwarded so the backend resolves the same user.
 *
 *   STRIDE_BACKEND_URL  base URL of the backend (default http://127.0.0.1:3001).
 *                       Behind Caddy in prod the web server still talks to the
 *                       backend on loopback; the browser never calls it directly.
 */
import { cookies } from "next/headers";

const BASE = process.env.STRIDE_BACKEND_URL?.replace(/\/$/, "") || "http://127.0.0.1:3001";

/** Forward the incoming request's cookies so the backend sees the session. */
async function cookieHeader(): Promise<string> {
  const jar = await cookies();
  return jar
    .getAll()
    .map((c) => `${c.name}=${c.value}`)
    .join("; ");
}

export interface BackendResult<T> {
  ok: boolean;
  status: number;
  data: T | null;
  /** Machine error code from the envelope, when !ok. */
  errorCode?: string;
}

/** GET a backend JSON endpoint, forwarding the session cookie. Fail-soft. */
export async function backendGet<T>(path: string): Promise<BackendResult<T>> {
  try {
    const res = await fetch(`${BASE}${path}`, {
      headers: { Accept: "application/json", Cookie: await cookieHeader() },
      cache: "no-store",
    });
    if (!res.ok) {
      let errorCode: string | undefined;
      try {
        errorCode = ((await res.json()) as { error?: { code?: string } }).error?.code;
      } catch {
        /* non-JSON error body */
      }
      return { ok: false, status: res.status, data: null, errorCode };
    }
    return { ok: true, status: res.status, data: (await res.json()) as T };
  } catch {
    return { ok: false, status: 0, data: null, errorCode: "network" };
  }
}

/** True when the backend says Fitbit is connected (any metric not 401'd). */
export function isNotConnected(r: BackendResult<unknown>): boolean {
  return r.errorCode === "provider_not_connected" || r.errorCode === "provider_unconfigured";
}
