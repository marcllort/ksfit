/**
 * Registry of all dashboard-local user settings. Adding a new entry here is
 * the only change required to surface a new setting end-to-end:
 *
 *   1. add an entry below (use the right factory for its kind),
 *   2. read it on the server with `getSetting("yourId")`,
 *   3. it auto-renders on /settings (the settings page iterates this object).
 *
 * Keep this file pure data — no `next/headers`, no React. It's imported by
 * both client and server code.
 */
import type { NumberSettingDef, SettingValueOfDef } from "./types";

function num(def: Omit<NumberSettingDef, "kind">): NumberSettingDef {
  return { kind: "number", ...def };
}

export const SETTINGS = {
  stepsGoal: num({
    key: "stride_steps_goal",
    label: "Daily step goal",
    description:
      "Used by the progress ring, the “Goal hit” headline, and the weekly bars.",
    default: 10_000,
    min: 1_000,
    max: 100_000,
    step: 500,
    presets: [5_000, 7_500, 10_000, 12_500, 15_000, 20_000],
    unit: "steps",
  }),
} as const;

export type SettingId = keyof typeof SETTINGS;
export type SettingValue<K extends SettingId> = SettingValueOfDef<
  (typeof SETTINGS)[K]
>;
