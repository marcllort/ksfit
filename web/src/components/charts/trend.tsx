"use client";
/**
 * Compact area / bar trend chart used in the dashboard hero strip and the
 * weight page. Wraps Recharts with theme-aware colours pulled from CSS vars.
 */
import {
  AreaChart,
  Area,
  BarChart,
  Bar,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
  ReferenceLine,
} from "recharts";

interface TrendDatum {
  label: string;
  value: number;
  raw?: unknown;
}

// Inline formatters keyed by name keep the component server-component-safe:
// callers can't pass closures across the boundary.
type ValueUnit = "" | "km" | "kg" | "kcal" | "min";
const fmtValue = (u: ValueUnit) => (v: number) =>
  u ? `${v} ${u}` : `${v}`;

export function AreaTrend({
  data,
  height = 110,
  unit = "",
  showAxes = true,
}: {
  data: TrendDatum[];
  height?: number;
  unit?: ValueUnit;
  showAxes?: boolean;
}) {
  const yFmt = fmtValue(unit);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="strideArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.55} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        {showAxes && (
          <>
            <XAxis
              dataKey="label"
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--ink-3)" }}
              minTickGap={20}
            />
            <YAxis
              tickLine={false}
              axisLine={false}
              tick={{ fontSize: 11, fill: "var(--ink-3)" }}
              width={36}
            />
          </>
        )}
        <Tooltip
          cursor={{ stroke: "var(--ink-4)", strokeDasharray: 3 }}
          contentStyle={{
            background: "var(--paper-1)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--ink-1)",
          }}
          formatter={(v: number) => [yFmt(v), ""]}
        />
        <Area
          type="monotone"
          dataKey="value"
          stroke="var(--accent)"
          strokeWidth={2}
          fill="url(#strideArea)"
          activeDot={{ r: 4, stroke: "var(--paper-0)", strokeWidth: 2 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function BarTrend({
  data,
  height = 140,
  unit = "",
  goal,
}: {
  data: TrendDatum[];
  height?: number;
  unit?: ValueUnit;
  goal?: number;
}) {
  const yFmt = fmtValue(unit);
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="label"
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--ink-3)" }}
          minTickGap={10}
        />
        <YAxis
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--ink-3)" }}
          width={36}
        />
        <Tooltip
          cursor={{ fill: "var(--paper-2)" }}
          contentStyle={{
            background: "var(--paper-1)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--ink-1)",
          }}
          formatter={(v: number) => [yFmt(v), ""]}
        />
        {goal ? (
          <ReferenceLine
            y={goal}
            stroke="var(--ink-4)"
            strokeDasharray="3 3"
            label={{
              value: "goal",
              position: "right",
              fontSize: 10,
              fill: "var(--ink-3)",
            }}
          />
        ) : null}
        <Bar
          dataKey="value"
          fill="var(--accent)"
          radius={[6, 6, 0, 0]}
          maxBarSize={24}
        />
      </BarChart>
    </ResponsiveContainer>
  );
}
