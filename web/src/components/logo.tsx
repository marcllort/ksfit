import { cn } from "./ui";

/**
 * Stride brand mark — a stylized "S" formed from a single open curve, evoking
 * a walking path. Rendered with `currentColor` so it inherits from the
 * surrounding text colour (caller controls foreground via Tailwind classes).
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
      <path
        d="M22.5 10.5C22.5 7.6 19.7 6 16 6c-3.7 0-6.5 1.8-6.5 4.9 0 3.3 3.3 4.2 6.5 5.1 3.2.9 6.5 1.8 6.5 5.1 0 3.1-2.8 4.9-6.5 4.9-3.7 0-6.5-1.6-6.5-4.5"
        stroke="currentColor"
        strokeWidth="3.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
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
