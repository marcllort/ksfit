import { NextResponse } from "next/server";
import { login, KSFitError } from "@/lib/ksfit";
import { setSession } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(req: Request) {
  let email = "";
  let password = "";
  try {
    const body = (await req.json()) as { email?: string; password?: string };
    email = body.email?.trim() ?? "";
    password = body.password ?? "";
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }
  if (!email || !password) {
    return NextResponse.json(
      { error: "email and password required" },
      { status: 400 },
    );
  }
  try {
    const { xjid, token } = await login(email, password);
    await setSession({ xjid, token });
    return NextResponse.json({ ok: true });
  } catch (e) {
    if (e instanceof KSFitError) {
      // KS Fit returns code=104 for bad password, 141 for rate-limit.
      const msg =
        e.code === "104"
          ? "Wrong email or password."
          : e.code === "141"
            ? "Too many failed logins — wait 15–30 min and retry."
            : (e.message || "Login failed.");
      return NextResponse.json({ error: msg }, { status: 401 });
    }
    return NextResponse.json({ error: "Login failed." }, { status: 500 });
  }
}
