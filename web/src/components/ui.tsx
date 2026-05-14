/**
 * Hand-rolled UI primitives. shadcn-flavoured (Tailwind-only, headless) but
 * fewer, simpler, theme-aware via the CSS variables defined in globals.css.
 */
import * as React from "react";

export function cn(...xs: (string | false | null | undefined)[]) {
  return xs.filter(Boolean).join(" ");
}

export function Card({
  children,
  className,
  ...rest
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "rounded-2xl border border-line bg-paper-1 shadow-card dark:shadow-card-dark",
        className,
      )}
      {...rest}
    >
      {children}
    </div>
  );
}

export function CardHeader({
  title,
  hint,
  action,
  className,
}: {
  title: React.ReactNode;
  hint?: React.ReactNode;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex items-start justify-between gap-3 p-5 pb-2", className)}>
      <div>
        <div className="text-sm font-medium text-ink-3 tracking-tight">{title}</div>
        {hint ? <div className="mt-0.5 text-xs text-ink-4">{hint}</div> : null}
      </div>
      {action ? <div className="shrink-0">{action}</div> : null}
    </div>
  );
}

export function Metric({
  label,
  value,
  unit,
  sub,
  icon,
  emphasis,
}: {
  label: string;
  value: React.ReactNode;
  unit?: string;
  sub?: React.ReactNode;
  icon?: React.ReactNode;
  emphasis?: boolean;
}) {
  return (
    <div
      className={cn(
        "flex flex-col gap-3 p-5",
        emphasis
          ? "bg-paper-2 dark:bg-paper-2 rounded-2xl"
          : "",
      )}
    >
      <div className="flex items-center justify-between gap-2 text-xs uppercase tracking-[0.12em] text-ink-3">
        <span>{label}</span>
        {icon ? <span className="text-ink-4">{icon}</span> : null}
      </div>
      <div className="flex items-baseline gap-1.5">
        <span className="tnum text-3xl font-semibold tracking-tight text-ink-0 sm:text-4xl">
          {value}
        </span>
        {unit ? (
          <span className="text-sm font-medium text-ink-3">{unit}</span>
        ) : null}
      </div>
      {sub ? (
        <div className="text-xs text-ink-3 tnum">{sub}</div>
      ) : null}
    </div>
  );
}

export function Pill({
  children,
  tone = "default",
  className,
}: {
  children: React.ReactNode;
  tone?: "default" | "accent" | "muted" | "good" | "warn" | "bad";
  className?: string;
}) {
  const tones: Record<string, string> = {
    default: "bg-paper-2 text-ink-2",
    muted: "bg-paper-2 text-ink-3",
    accent: "bg-accent text-accent-fg",
    good: "bg-[color:var(--positive)]/10 text-[color:var(--positive)]",
    warn: "bg-[color:var(--warn)]/10 text-[color:var(--warn)]",
    bad: "bg-[color:var(--bad)]/10 text-[color:var(--bad)]",
  };
  return (
    <span
      className={cn(
        "inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium tnum",
        tones[tone],
        className,
      )}
    >
      {children}
    </span>
  );
}

export function Button({
  children,
  variant = "primary",
  className,
  ...rest
}: React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: "primary" | "secondary" | "ghost";
}) {
  const variants: Record<string, string> = {
    primary:
      "bg-accent text-accent-fg hover:opacity-90 disabled:opacity-50",
    secondary:
      "bg-paper-2 text-ink-1 hover:bg-paper-3 border border-line",
    ghost:
      "bg-transparent text-ink-2 hover:bg-paper-2 border border-transparent",
  };
  return (
    <button
      className={cn(
        "focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-full px-4 text-sm font-medium transition-colors",
        variants[variant],
        className,
      )}
      {...rest}
    >
      {children}
    </button>
  );
}

export function Empty({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-line bg-paper-1/50 p-10 text-center text-sm text-ink-3">
      {children}
    </div>
  );
}
