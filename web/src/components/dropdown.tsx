"use client";
import { useEffect, useRef, useState } from "react";
import { Check, ChevronDown } from "lucide-react";
import { cn } from "./ui";

export interface DropdownOption<V extends string> {
  value: V;
  label: string;
}

interface Props<V extends string> {
  value: V;
  onChange: (v: V) => void;
  options: DropdownOption<V>[];
  label?: string;
  className?: string;
  /** Where the menu opens. Default "right" (aligned to right edge). */
  align?: "left" | "right";
}

/**
 * Theme-aware single-select dropdown. Replaces the native `<select>` so the
 * dropdown body, options, and focus rings all use our design tokens.
 */
export function Dropdown<V extends string>({
  value,
  onChange,
  options,
  label,
  className,
  align = "right",
}: Props<V>) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  // Outside-click & Escape dismiss the menu.
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDoc);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const current = options.find((o) => o.value === value);

  return (
    <div ref={ref} className={cn("relative inline-block", className)}>
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        className="focus-ring inline-flex h-9 items-center gap-1.5 rounded-full border border-line bg-paper-1 px-3 text-xs font-medium text-ink-1 transition-colors hover:bg-paper-2"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        {label ? <span className="text-ink-3">{label}:</span> : null}
        <span>{current?.label ?? value}</span>
        <ChevronDown
          className={cn(
            "h-3.5 w-3.5 text-ink-3 transition-transform",
            open && "rotate-180",
          )}
        />
      </button>

      {open ? (
        <div
          role="listbox"
          className={cn(
            "absolute z-40 mt-2 min-w-[200px] origin-top overflow-hidden rounded-2xl border border-line bg-paper-1 shadow-card dark:shadow-card-dark",
            align === "right" ? "right-0" : "left-0",
            "animate-rise",
          )}
        >
          <ul className="py-1.5">
            {options.map((opt) => {
              const selected = opt.value === value;
              return (
                <li key={opt.value}>
                  <button
                    type="button"
                    onClick={() => {
                      onChange(opt.value);
                      setOpen(false);
                    }}
                    className={cn(
                      "flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-paper-2 text-ink-0"
                        : "text-ink-2 hover:bg-paper-2 hover:text-ink-0",
                    )}
                    role="option"
                    aria-selected={selected}
                  >
                    <span>{opt.label}</span>
                    {selected ? (
                      <Check className="h-3.5 w-3.5 text-accent" />
                    ) : null}
                  </button>
                </li>
              );
            })}
          </ul>
        </div>
      ) : null}
    </div>
  );
}
