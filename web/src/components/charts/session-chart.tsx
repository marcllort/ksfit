"use client";
import {
  ComposedChart,
  Area,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  CartesianGrid,
} from "recharts";
import type { SessionPoint } from "@/lib/data";

interface Props {
  points: SessionPoint[];
}

function fmtTime(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

export function SessionChart({ points }: Props) {
  const data = points.map((p) => ({
    t: p.t,
    speed: Number(p.speedKmh.toFixed(2)),
    cadence: p.cadence || null,
  }));

  return (
    <ResponsiveContainer width="100%" height={300}>
      <ComposedChart data={data} margin={{ top: 16, right: 20, left: 0, bottom: 6 }}>
        <defs>
          <linearGradient id="speedFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--accent)" stopOpacity={0.6} />
            <stop offset="100%" stopColor="var(--accent)" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke="var(--grid)" vertical={false} />
        <XAxis
          dataKey="t"
          type="number"
          domain={["dataMin", "dataMax"]}
          tickFormatter={fmtTime}
          tickLine={false}
          axisLine={false}
          tick={{ fontSize: 11, fill: "var(--ink-3)" }}
          minTickGap={30}
        />
        <YAxis
          yAxisId="speed"
          domain={[0, "dataMax + 0.5"]}
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}`}
          tick={{ fontSize: 11, fill: "var(--ink-3)" }}
          width={32}
          label={{
            value: "km/h",
            angle: -90,
            position: "insideLeft",
            fontSize: 10,
            fill: "var(--ink-4)",
            offset: 16,
          }}
        />
        <YAxis
          yAxisId="cadence"
          orientation="right"
          tickLine={false}
          axisLine={false}
          tickFormatter={(v) => `${v}`}
          tick={{ fontSize: 11, fill: "var(--ink-4)" }}
          width={36}
        />
        <Tooltip
          contentStyle={{
            background: "var(--paper-1)",
            border: "1px solid var(--line)",
            borderRadius: 10,
            fontSize: 12,
            color: "var(--ink-1)",
          }}
          labelFormatter={(t: number) => `t = ${fmtTime(t)}`}
          formatter={(v: number, name: string) => {
            if (name === "speed") return [`${v} km/h`, "Speed"];
            if (name === "cadence") return [`${v} spm`, "Cadence"];
            return [v, name];
          }}
        />
        <Area
          yAxisId="speed"
          type="monotone"
          dataKey="speed"
          stroke="var(--accent)"
          strokeWidth={2.5}
          fill="url(#speedFill)"
          dot={false}
          isAnimationActive={false}
        />
        <Line
          yAxisId="cadence"
          type="monotone"
          dataKey="cadence"
          stroke="var(--ink-3)"
          strokeWidth={1.5}
          strokeDasharray="3 3"
          dot={false}
          connectNulls
        />
      </ComposedChart>
    </ResponsiveContainer>
  );
}
