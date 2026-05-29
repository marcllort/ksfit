"use client";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Activity, CalendarDays, Footprints, HeartPulse, LineChart } from "lucide-react";
import { ThemeToggle } from "./theme";
import { LogoTile } from "./logo";
import { UserMenu } from "./user-menu";
import { cn } from "./ui";

interface Props {
  userName: string;
  userAvatar?: string;
  children: React.ReactNode;
}

const nav = [
  { href: "/", label: "Overview", icon: Activity },
  { href: "/sessions", label: "Sessions", icon: Footprints },
  { href: "/calendar", label: "Calendar", icon: CalendarDays },
  { href: "/weight", label: "Weight", icon: LineChart },
  { href: "/fitbit", label: "Fitbit", icon: HeartPulse },
];

export function Shell({ userName, userAvatar, children }: Props) {
  const path = usePathname();

  return (
    <div className="mx-auto flex min-h-dvh max-w-[1400px] flex-col px-4 sm:px-6 lg:px-8">
      <header className="sticky top-0 z-30 -mx-4 sm:-mx-6 lg:-mx-8">
        <div className="mx-auto max-w-[1400px] px-4 sm:px-6 lg:px-8">
          <div className="flex h-16 items-center justify-between gap-3 border-b border-line bg-paper-0/80 backdrop-blur-xl">
            <Link href="/" className="flex items-center gap-2">
              <LogoTile className="h-8 w-8 rounded-lg" />
              <span className="text-base font-semibold tracking-tight">Stride</span>
              <span className="ml-1 hidden text-xs text-ink-4 sm:inline">/ KS Fit</span>
            </Link>

            <nav className="hidden gap-1 md:flex">
              {nav.map(({ href, label, icon: Icon }) => {
                const active = href === "/" ? path === "/" : path.startsWith(href);
                return (
                  <Link
                    key={href}
                    href={href}
                    className={cn(
                      "focus-ring inline-flex items-center gap-2 rounded-full px-3.5 py-1.5 text-sm font-medium transition-colors",
                      active
                        ? "bg-paper-2 text-ink-0"
                        : "text-ink-3 hover:bg-paper-2 hover:text-ink-1",
                    )}
                  >
                    <Icon className="h-3.5 w-3.5" />
                    {label}
                  </Link>
                );
              })}
            </nav>

            <div className="flex items-center gap-2">
              <ThemeToggle />
              <UserMenu userName={userName} userAvatar={userAvatar} />
            </div>
          </div>
        </div>
      </header>

      <main className="flex-1 py-8 sm:py-10">{children}</main>

      <nav className="sticky bottom-3 z-30 mx-auto mb-2 mt-6 flex w-fit gap-1 rounded-full border border-line bg-paper-1/90 p-1 shadow-card backdrop-blur-xl md:hidden">
        {nav.map(({ href, label, icon: Icon }) => {
          const active = href === "/" ? path === "/" : path.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium transition-colors",
                active ? "bg-ink-0 text-paper-0" : "text-ink-3",
              )}
            >
              <Icon className="h-3.5 w-3.5" />
              {label}
            </Link>
          );
        })}
      </nav>

      <footer className="border-t border-line pb-10 pt-6 text-xs text-ink-4">
        Stride · Unofficial KS Fit / Kingsmith dashboard · read-only
      </footer>
    </div>
  );
}
