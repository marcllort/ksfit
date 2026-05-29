/**
 * Auth routes (ported from apps/web/src/app/api/{login,logout}).
 * Phase 2 replaces the raw KS Fit cookie with an opaque Stride session token.
 */
import { Hono } from "hono";
import { login, KSFitError } from "@stride/ksfit-client";
import { setSessionCookie, clearSessionCookie, getSessionFromCookie } from "../lib/ksfit/session.ts";
import { invalidateUser } from "../lib/cache.ts";
import { apiError } from "../lib/errors.ts";

type Env = { Variables: { requestId: string } };
export const authRoutes = new Hono<Env>();

authRoutes.post("/login", async (c) => {
  let email = "";
  let password = "";
  try {
    const body = (await c.req.json()) as { email?: string; password?: string };
    email = body.email?.trim() ?? "";
    password = body.password ?? "";
  } catch {
    return apiError(c, "invalid_request", "invalid JSON");
  }
  if (!email || !password) {
    return apiError(c, "invalid_request", "email and password required");
  }
  try {
    const { xjid, token } = await login(email, password);
    setSessionCookie(c, { xjid, token });
    return c.json({ ok: true });
  } catch (e) {
    if (e instanceof KSFitError) {
      const msg =
        e.code === "104"
          ? "Wrong email or password."
          : e.code === "141"
            ? "Too many failed logins — wait 15–30 min and retry."
            : e.message || "Login failed.";
      return apiError(c, "unauthenticated", msg);
    }
    return apiError(c, "internal", "Login failed.");
  }
});

authRoutes.post("/logout", (c) => {
  // Wipe the cookie AND this process's cached responses for the user.
  const s = getSessionFromCookie(c);
  if (s) invalidateUser(s.xjid);
  clearSessionCookie(c);
  return c.json({ ok: true });
});
