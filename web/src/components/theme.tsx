"use client";
import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { cn } from "./ui";

type Theme = "light" | "dark" | "system";

const STORAGE_KEY = "ks_theme";

function resolveTheme(theme: Theme): "light" | "dark" {
  if (theme === "system") {
    return window.matchMedia("(prefers-color-scheme: dark)").matches
      ? "dark"
      : "light";
  }
  return theme;
}

function applyTheme(theme: Theme) {
  const root = document.documentElement;
  if (resolveTheme(theme) === "dark") root.classList.add("dark");
  else root.classList.remove("dark");
}

/**
 * Re-asserts the `dark` class on <html> after React hydration finishes.
 *
 * The inline ThemeScript sets it pre-paint, but React's reconciliation of
 * <html> during hydration may strip any class not present in the server
 * render. This component runs in a `useLayoutEffect` (synchronously before
 * paint) and restores the user's choice.
 */
export function ThemeApplier() {
  useLayoutEffect(() => {
    try {
      const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
      applyTheme(saved);
    } catch {
      /* noop */
    }
  }, []);
  return null;
}

/**
 * Inlined as a `<script>` in <head> so the theme class is applied before any
 * paint — avoids the light/dark flash on first load.
 */
export function ThemeScript() {
  const code = `
    (function () {
      try {
        var saved = localStorage.getItem('${STORAGE_KEY}') || 'system';
        var prefersDark = window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches;
        var effective = saved === 'system' ? (prefersDark ? 'dark' : 'light') : saved;
        var root = document.documentElement;
        if (effective === 'dark') root.classList.add('dark');
        else root.classList.remove('dark');
        // Re-apply after React hydration finishes — covers the case where
        // React strips the class while reconciling the <html> element.
        document.addEventListener('DOMContentLoaded', function () {
          requestAnimationFrame(function () {
            if (effective === 'dark') root.classList.add('dark');
            else root.classList.remove('dark');
          });
        });
      } catch (_) {}
    })();
  `;
  return <script dangerouslySetInnerHTML={{ __html: code }} />;
}

const OPTIONS: { value: Theme; label: string; Icon: typeof Sun }[] = [
  { value: "light", label: "Light", Icon: Sun },
  { value: "dark", label: "Dark", Icon: Moon },
  { value: "system", label: "System", Icon: Monitor },
];

export function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>("system");
  const [mounted, setMounted] = useState(false);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const saved = (localStorage.getItem(STORAGE_KEY) as Theme | null) ?? "system";
    setTheme(saved);
    setMounted(true);
  }, []);

  // When tracking the OS, follow live changes to `prefers-color-scheme`.
  useEffect(() => {
    if (theme !== "system") return;
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => applyTheme("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, [theme]);

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

  const pick = (next: Theme) => {
    setTheme(next);
    try {
      localStorage.setItem(STORAGE_KEY, next);
    } catch {
      /* noop */
    }
    applyTheme(next);
    setOpen(false);
  };

  const CurrentIcon = mounted
    ? (OPTIONS.find((o) => o.value === theme)?.Icon ?? Sun)
    : Sun;

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen((s) => !s)}
        aria-label="Theme"
        aria-haspopup="listbox"
        aria-expanded={open}
        className="focus-ring inline-flex h-9 w-9 items-center justify-center rounded-full border border-line bg-paper-1 text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink-0"
      >
        {mounted ? (
          <CurrentIcon className="h-4 w-4" />
        ) : (
          <span className="h-4 w-4" />
        )}
      </button>
      {open ? (
        <div
          role="listbox"
          className="animate-rise absolute right-0 z-40 mt-2 min-w-[140px] origin-top overflow-hidden rounded-2xl border border-line bg-paper-1 shadow-card dark:shadow-card-dark"
        >
          <ul className="py-1.5">
            {OPTIONS.map(({ value, label, Icon }) => {
              const selected = value === theme;
              return (
                <li key={value}>
                  <button
                    type="button"
                    onClick={() => pick(value)}
                    role="option"
                    aria-selected={selected}
                    className={cn(
                      "flex w-full items-center gap-2 px-3 py-2 text-left text-sm transition-colors",
                      selected
                        ? "bg-paper-2 text-ink-0"
                        : "text-ink-2 hover:bg-paper-2 hover:text-ink-0",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
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
