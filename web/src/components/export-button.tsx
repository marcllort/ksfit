import { Download } from "lucide-react";
import { cn } from "./ui";

/**
 * A styled download link for the CSV export endpoints. Uses a plain anchor with
 * `download` so the browser streams the file straight from the Route Handler —
 * no client JS, works in a server component.
 */
export function ExportButton({
  href,
  label = "Export CSV",
  className,
}: {
  href: string;
  label?: string;
  className?: string;
}) {
  return (
    <a
      href={href}
      download
      className={cn(
        "focus-ring inline-flex h-9 items-center justify-center gap-2 rounded-full border border-line bg-paper-2 px-4 text-sm font-medium text-ink-1 transition-colors hover:bg-paper-3",
        className,
      )}
    >
      <Download className="h-4 w-4" />
      {label}
    </a>
  );
}
