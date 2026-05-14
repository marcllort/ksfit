"use client";
import { useEffect, useState } from "react";

/**
 * Renders a date in the user's locale, hydration-safe.
 *
 * Server renders the deterministic ISO snippet provided as `fallback`; on
 * mount we replace it with `Intl.DateTimeFormat` output. Avoiding
 * `toLocaleString` on the server keeps SSR output stable across timezones.
 */
export function LocalTime({
  iso,
  options,
  fallback,
  className,
}: {
  iso: string;
  options: Intl.DateTimeFormatOptions;
  fallback: string;
  className?: string;
}) {
  const [text, setText] = useState(fallback);
  useEffect(() => {
    try {
      setText(new Date(iso).toLocaleString(undefined, options));
    } catch {
      /* keep fallback */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [iso]);
  return <span className={className}>{text}</span>;
}
