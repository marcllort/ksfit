"use client";
import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import { LogOut, Settings as SettingsIcon } from "lucide-react";
import { cn } from "./ui";

interface Props {
  userName: string;
  userAvatar?: string;
}

/**
 * Header avatar trigger + popover menu. Replaces the trio of standalone
 * Settings/Avatar/Sign-out chips in the header — one tap target on any size,
 * keyboard-accessible, dismisses on outside-click or Escape.
 */
export function UserMenu({ userName, userAvatar }: Props) {
  const [open, setOpen] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const router = useRouter();
  const path = usePathname();

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

  // Auto-close when the URL changes (e.g. tapping the Settings link).
  useEffect(() => {
    setOpen(false);
  }, [path]);

  const logout = async () => {
    if (signingOut) return;
    setSigningOut(true);
    try {
      await fetch("/api/logout", { method: "POST" });
      router.push("/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  };

  const initial = userName.charAt(0).toUpperCase() || "?";

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((s) => !s)}
        aria-label="Account menu"
        aria-haspopup="menu"
        aria-expanded={open}
        className={cn(
          "focus-ring inline-flex h-9 w-9 shrink-0 items-center justify-center overflow-hidden rounded-full border bg-paper-1 align-middle text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink-0",
          open ? "border-accent bg-paper-2" : "border-line",
        )}
      >
        {userAvatar ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={userAvatar}
            alt=""
            className="block h-full w-full object-cover"
          />
        ) : (
          <span className="text-xs font-semibold leading-none">{initial}</span>
        )}
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-rise absolute right-0 z-40 mt-2 w-[min(16rem,calc(100vw-1.5rem))] origin-top-right overflow-hidden rounded-2xl border border-line bg-paper-1 shadow-card dark:shadow-card-dark"
        >
          <div className="flex items-center gap-3 border-b border-line px-3.5 py-3">
            <div className="h-9 w-9 shrink-0 overflow-hidden rounded-full border border-line bg-paper-2">
              {userAvatar ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={userAvatar}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="grid h-full w-full place-items-center text-xs font-semibold text-ink-2">
                  {initial}
                </div>
              )}
            </div>
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold text-ink-0">
                {userName}
              </div>
              <div className="truncate text-[11px] uppercase tracking-wider text-ink-4">
                Stride · KS Fit
              </div>
            </div>
          </div>

          <div className="py-1.5">
            <Link
              href="/settings"
              role="menuitem"
              className="flex items-center gap-2.5 px-3.5 py-2 text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink-0"
            >
              <SettingsIcon className="h-4 w-4 text-ink-3" />
              <span>Settings</span>
            </Link>
            <button
              type="button"
              role="menuitem"
              onClick={logout}
              disabled={signingOut}
              className="flex w-full items-center gap-2.5 px-3.5 py-2 text-left text-sm text-ink-2 transition-colors hover:bg-paper-2 hover:text-ink-0 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <LogOut className="h-4 w-4 text-ink-3" />
              <span>{signingOut ? "Signing out…" : "Sign out"}</span>
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
