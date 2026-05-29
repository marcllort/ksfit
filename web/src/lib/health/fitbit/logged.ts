/**
 * Bookkeeping for which source sessions have been pushed to Fitbit, so the
 * dashboard can show "On Fitbit" and the log route can dedupe. Stored in an
 * httpOnly cookie shared with the /api/fitbit/log route.
 */
import { cookies } from "next/headers";

const LOGGED_COOKIE = "fitbit_logged";

export async function loggedSet(): Promise<Set<string>> {
  const raw = (await cookies()).get(LOGGED_COOKIE)?.value;
  if (!raw) return new Set();
  try {
    return new Set(JSON.parse(raw) as string[]);
  } catch {
    return new Set();
  }
}

export async function rememberLogged(ids: Set<string>): Promise<void> {
  const c = await cookies();
  const arr = Array.from(ids).slice(-500); // bound cookie size
  c.set(LOGGED_COOKIE, JSON.stringify(arr), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 365,
  });
}

export async function isLogged(runId: string): Promise<boolean> {
  return (await loggedSet()).has(runId);
}
