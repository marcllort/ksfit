import { cn } from "./ui";

/**
 * Stride brand mark — four ascending capsule bars, evoking an upward trend
 * (steps, distance, fitness — all of which we want going up over time).
 * Rendered with `currentColor` so it inherits from the surrounding text
 * colour; the caller controls foreground via Tailwind classes.
 */
export function LogoMark({ className }: { className?: string }) {
  return (
    <svg
      viewBox="0 0 32 32"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      className={className}
    >
      <g
        stroke="currentColor"
        strokeWidth="3"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <line x1="6" y1="22" x2="6" y2="26" />
        <line x1="13" y1="17" x2="13" y2="26" />
        <line x1="19" y1="12" x2="19" y2="26" />
        <line x1="26" y1="7" x2="26" y2="26" />
      </g>
    </svg>
  );
}

/**
 * Tiled brand mark: the `LogoMark` reversed-out on a dark tile. Matches the
 * Stride accent treatment used in the header and the login splash.
 */
export function LogoTile({
  className,
  markClassName,
}: {
  className?: string;
  markClassName?: string;
}) {
  return (
    <div
      className={cn(
        "grid place-items-center bg-ink-0 text-paper-0",
        className,
      )}
    >
      <LogoMark className={cn("h-[58%] w-[58%]", markClassName)} />
    </div>
  );
}
