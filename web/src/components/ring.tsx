/**
 * Single-arc progress ring. SVG-based, theme-aware via CSS variables.
 */
interface Props {
  /** 0..1+ (over 1 means "exceeded goal" — we cap visually but show full ring) */
  progress: number;
  size?: number;
  stroke?: number;
  /** Optional second arc for a secondary metric (0..1). */
  secondary?: number;
  children?: React.ReactNode;
  className?: string;
}

export function Ring({
  progress,
  size = 200,
  stroke = 12,
  secondary,
  children,
  className,
}: Props) {
  const r = (size - stroke) / 2;
  const c = 2 * Math.PI * r;
  const filled = Math.min(1, Math.max(0, progress));
  const exceeds = progress > 1;
  return (
    <div
      className={`relative inline-grid place-items-center ${className ?? ""}`}
      style={{ width: size, height: size }}
    >
      <svg
        width={size}
        height={size}
        viewBox={`0 0 ${size} ${size}`}
        className="-rotate-90"
        aria-hidden
      >
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--paper-2)"
          strokeWidth={stroke}
        />
        {secondary !== undefined ? (
          <circle
            cx={size / 2}
            cy={size / 2}
            r={r}
            fill="none"
            stroke="var(--ink-4)"
            strokeOpacity={0.35}
            strokeWidth={stroke / 2}
            strokeDasharray={c}
            strokeDashoffset={c * (1 - Math.min(1, Math.max(0, secondary)))}
            strokeLinecap="round"
          />
        ) : null}
        <circle
          cx={size / 2}
          cy={size / 2}
          r={r}
          fill="none"
          stroke="var(--accent)"
          strokeWidth={stroke}
          strokeDasharray={c}
          strokeDashoffset={c * (1 - filled)}
          strokeLinecap="round"
          style={{
            transition: "stroke-dashoffset 600ms cubic-bezier(0.16, 1, 0.3, 1)",
            filter: exceeds ? "drop-shadow(0 0 12px var(--accent-soft))" : undefined,
          }}
        />
      </svg>
      <div className="absolute inset-0 grid place-items-center">{children}</div>
    </div>
  );
}
