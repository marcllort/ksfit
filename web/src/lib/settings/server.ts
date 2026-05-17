import "server-only";
import { cookies } from "next/headers";
import { SETTINGS, type SettingId, type SettingValue } from "./definitions";
import { parseSettingValue } from "./parse";

/** Read a single setting from the request's cookies. */
export async function getSetting<K extends SettingId>(
  id: K,
): Promise<SettingValue<K>> {
  const def = SETTINGS[id];
  const raw = (await cookies()).get(def.key)?.value;
  return parseSettingValue(id, raw);
}

/** Read every registered setting in one cookie traversal. */
export async function getAllSettings(): Promise<{
  [K in SettingId]: SettingValue<K>;
}> {
  const c = await cookies();
  const out = {} as { [K in SettingId]: SettingValue<K> };
  for (const id of Object.keys(SETTINGS) as SettingId[]) {
    const raw = c.get(SETTINGS[id].key)?.value;
    out[id] = parseSettingValue(id, raw) as never;
  }
  return out;
}
