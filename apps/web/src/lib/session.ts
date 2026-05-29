/**
 * Server-side session helpers.
 *
 * The KS Fit `{xjid, token}` pair is stored in a single httpOnly cookie so
 * server components and route handlers can recover it without any client
 * JavaScript touching the JWT.
 */
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import type { Session } from "@stride/ksfit-client";
import { autoSession } from "./auto-login";

const COOKIE = "ksfit_session";

export async function setSession(s: Session) {
  const c = await cookies();
  c.set(COOKIE, JSON.stringify(s), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    // ~90 days, matches the JWT expiry on the upstream.
    maxAge: 60 * 60 * 24 * 90,
  });
}

export async function clearSession() {
  const c = await cookies();
  c.delete(COOKIE);
}

export async function getSession(): Promise<Session | null> {
  const raw = (await cookies()).get(COOKIE)?.value;
  if (!raw) return null;
  try {
    const s = JSON.parse(raw) as Session;
    if (!s.xjid || !s.token) return null;
    return s;
  } catch {
    return null;
  }
}

export async function requireSession(): Promise<Session> {
  const s = await getSession();
  if (s) return s;
  // Fall back to env-credential auto-login (single-user self-hosted installs).
  const auto = await autoSession();
  if (auto) return auto;
  redirect("/login");
}

/**
 * Ensure a Session persists any token KS Fit rotates mid-request (ret=402).
 *
 * The env auto-login Session already brings its own in-memory `onRotate`, so we
 * never clobber it (and must not — writing a cookie during a server render
 * throws). For a cookie-backed Session we install a handler that writes the
 * fresh JWT back to the cookie, so the next request doesn't re-rotate. Call
 * this from every data-fetch entry point.
 */
export function ensureRotationPersist(session: Session): void {
  if (session.onRotate) return;
  session.onRotate = async (token) => {
    await setSession({ xjid: session.xjid, token });
  };
}
