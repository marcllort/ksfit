/**
 * Setting definition types — the shape of an entry in the settings registry.
 *
 * The registry is the single source of truth for dashboard-local user
 * preferences: every setting declares its cookie key, label, default, and
 * (kind-specific) UI constraints. The server reader, the update action, and
 * the UI form all derive from this — adding a new setting means adding a
 * single entry to `definitions.ts` and (if it's a new kind) one field
 * component in `components/settings/`.
 */

interface BaseSettingDef {
  /** Cookie name used to persist this setting. Globally unique. */
  readonly key: string;
  /** Title shown in the settings page card. */
  readonly label: string;
  /** Short explanation shown under the title. */
  readonly description?: string;
}

export interface NumberSettingDef extends BaseSettingDef {
  readonly kind: "number";
  readonly default: number;
  readonly min: number;
  readonly max: number;
  /** Native number-input step. Defaults to 1. */
  readonly step?: number;
  /** Optional quick-pick chips. Each posts the preset value as the new save. */
  readonly presets?: readonly number[];
  /** Suffix label rendered next to the input (e.g. "steps", "kg"). */
  readonly unit?: string;
}

export type SettingDef = NumberSettingDef;
export type SettingKind = SettingDef["kind"];

/** Value type carried by a given setting definition. */
export type SettingValueOfDef<T extends SettingDef> =
  T extends NumberSettingDef ? number : never;

/**
 * Action result shape returned by every settings server action. The `ts`
 * field is a monotonic marker so the client `useEffect` fires on every
 * submit — including when the new value equals the previous one.
 */
export interface SettingActionState {
  id: string;
  ok: boolean;
  value: unknown;
  message?: string;
  ts: number;
}

export const SETTING_ACTION_INITIAL: SettingActionState = {
  id: "",
  ok: false,
  value: null,
  ts: 0,
};
