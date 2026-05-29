/**
 * Pure parse/serialize helpers, shared by server reader, server actions, and
 * client field components. No `next/headers`, no React.
 */
import { SETTINGS, type SettingId, type SettingValue } from "./definitions";
import type { NumberSettingDef, SettingDef } from "./types";

export function parseSettingValue<K extends SettingId>(
  id: K,
  raw: string | null | undefined,
): SettingValue<K> {
  const def = SETTINGS[id] as SettingDef;
  return parseByKind(def, raw) as SettingValue<K>;
}

export function serializeSettingValue<K extends SettingId>(
  _id: K,
  value: SettingValue<K>,
): string {
  return String(value);
}

function parseByKind(def: SettingDef, raw: string | null | undefined): unknown {
  switch (def.kind) {
    case "number":
      return parseNumber(def, raw);
  }
}

function parseNumber(
  def: NumberSettingDef,
  raw: string | null | undefined,
): number {
  if (raw == null || raw === "") return def.default;
  const n = Number(raw);
  if (!Number.isFinite(n) || n <= 0) return def.default;
  return Math.min(def.max, Math.max(def.min, Math.round(n)));
}
