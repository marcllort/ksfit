"use server";
import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { SETTINGS, type SettingId } from "./definitions";
import { parseSettingValue, serializeSettingValue } from "./parse";
import type { SettingActionState } from "./types";

const ONE_YEAR = 60 * 60 * 24 * 365;

function isSettingId(id: unknown): id is SettingId {
  return typeof id === "string" && id in SETTINGS;
}

function fail(message: string): SettingActionState {
  return { id: "", ok: false, value: null, message, ts: Date.now() };
}

/**
 * Generic save action — the form must include a `__setting` hidden field
 * naming the target setting and a `value` field carrying the raw input.
 */
export async function updateSetting(
  _prev: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const id = formData.get("__setting");
  if (!isSettingId(id)) return fail("Unknown setting");

  const def = SETTINGS[id];
  const raw = formData.get("value");
  const value = parseSettingValue(id, raw == null ? null : String(raw));

  (await cookies()).set(def.key, serializeSettingValue(id, value), {
    httpOnly: false,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: ONE_YEAR,
  });
  revalidatePath("/", "layout");
  return { id, ok: true, value, ts: Date.now() };
}

/** Generic reset — same form contract, no `value` field required. */
export async function resetSetting(
  _prev: SettingActionState,
  formData: FormData,
): Promise<SettingActionState> {
  const id = formData.get("__setting");
  if (!isSettingId(id)) return fail("Unknown setting");

  const def = SETTINGS[id];
  (await cookies()).delete(def.key);
  revalidatePath("/", "layout");
  return {
    id,
    ok: true,
    value: def.default,
    message: "reset",
    ts: Date.now(),
  };
}
