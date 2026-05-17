"use client";
import { useActionState, useEffect, useState } from "react";
import { toast } from "sonner";
import { resetSetting, updateSetting } from "@/lib/settings/actions";
import { SETTINGS, type SettingId } from "@/lib/settings/definitions";
import {
  SETTING_ACTION_INITIAL,
  type SettingActionState,
} from "@/lib/settings/types";

/**
 * Renders a number-kind setting from the registry: input + presets + reset,
 * wired to the generic server actions. The "dirty / saving / saved" button
 * states, the toast feedback, and the action-result→input sync all live here
 * once, so new number settings cost zero UI code.
 */
export function NumberSettingField({
  id,
  saved,
}: {
  id: SettingId;
  saved: number;
}) {
  const def = SETTINGS[id];
  if (def.kind !== "number") {
    throw new Error(`NumberSettingField mounted on non-number setting "${id}"`);
  }

  const [input, setInput] = useState<number | "">(saved);
  const [save, saveAction, savePending] = useActionState<
    SettingActionState,
    FormData
  >(updateSetting, SETTING_ACTION_INITIAL);
  const [reset, resetAction, resetPending] = useActionState<
    SettingActionState,
    FormData
  >(resetSetting, SETTING_ACTION_INITIAL);

  // Surface save results as a toast and sync the input to the new saved
  // value so the dirty check flips back off.
  useEffect(() => {
    if (save.ts === 0 || save.id !== id) return;
    if (save.ok) {
      const v = save.value as number;
      toast.success(
        `${def.label} saved · ${v.toLocaleString()}${def.unit ? ` ${def.unit}` : ""}`,
      );
      setInput(v);
    } else if (save.message) {
      toast.error(save.message);
    }
  }, [save.ts, save.ok, save.value, save.message, save.id, id, def]);

  useEffect(() => {
    if (reset.ts === 0 || reset.id !== id) return;
    if (reset.ok) {
      toast.success(
        `${def.label} reset · ${def.default.toLocaleString()}${def.unit ? ` ${def.unit}` : ""}`,
      );
      setInput(def.default);
    }
  }, [reset.ts, reset.ok, reset.id, id, def]);

  const dirty = typeof input === "number" && input !== saved;
  const isDefault = saved === def.default;
  const anyPending = savePending || resetPending;

  return (
    <div className="space-y-5 p-5 pt-2">
      <form action={saveAction} className="space-y-3">
        <input type="hidden" name="__setting" value={id} />
        <label
          htmlFor={`setting-${id}`}
          className="block text-xs font-medium uppercase tracking-[0.12em] text-ink-3"
        >
          {def.label}
        </label>
        <div className="flex flex-wrap items-center gap-2">
          <input
            id={`setting-${id}`}
            name="value"
            type="number"
            inputMode="numeric"
            min={def.min}
            max={def.max}
            step={def.step ?? 1}
            value={input}
            onChange={(e) => {
              const v = e.target.value;
              setInput(v === "" ? "" : Number(v));
            }}
            required
            disabled={anyPending}
            className="tnum focus-ring h-11 w-40 rounded-xl border border-line bg-paper-0 px-3 text-lg font-semibold tracking-tight text-ink-0 outline-none disabled:opacity-60"
          />
          {def.unit ? (
            <span className="text-sm text-ink-3">{def.unit}</span>
          ) : null}
          <button
            type="submit"
            disabled={!dirty || anyPending}
            className="focus-ring ml-auto inline-flex h-10 items-center justify-center rounded-full bg-accent px-5 text-sm font-semibold text-accent-fg transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-40"
          >
            {savePending ? "Saving…" : dirty ? "Save" : "Saved"}
          </button>
        </div>
        <p className="text-xs text-ink-4 tnum">
          Allowed range: {def.min.toLocaleString()} –{" "}
          {def.max.toLocaleString()} · Default {def.default.toLocaleString()}
        </p>
      </form>

      {def.presets && def.presets.length > 0 ? (
        <div>
          <div className="text-xs font-medium uppercase tracking-[0.12em] text-ink-3">
            Quick picks
          </div>
          <div className="mt-2 flex flex-wrap gap-2">
            {def.presets.map((p) => {
              const active = p === saved;
              return (
                <form key={p} action={saveAction}>
                  <input type="hidden" name="__setting" value={id} />
                  <input type="hidden" name="value" value={p} />
                  <button
                    type="submit"
                    disabled={active || anyPending}
                    className={`tnum focus-ring inline-flex h-8 items-center rounded-full border px-3 text-xs font-medium transition-colors disabled:cursor-not-allowed ${
                      active
                        ? "border-accent bg-accent text-accent-fg"
                        : "border-line bg-paper-1 text-ink-2 hover:bg-paper-2 disabled:opacity-50"
                    }`}
                  >
                    {p.toLocaleString()}
                  </button>
                </form>
              );
            })}
          </div>
        </div>
      ) : null}

      <form action={resetAction}>
        <input type="hidden" name="__setting" value={id} />
        <button
          type="submit"
          disabled={isDefault || anyPending}
          className="focus-ring inline-flex h-9 items-center justify-center rounded-full border border-line bg-paper-1 px-4 text-xs font-medium text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-40 disabled:hover:bg-paper-1 disabled:hover:text-ink-2"
        >
          {resetPending ? "Resetting…" : "Reset to default"}
        </button>
      </form>
    </div>
  );
}
