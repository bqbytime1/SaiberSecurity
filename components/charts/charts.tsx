"use client";

import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { TimeBucket } from "@/lib/metrics";
import type { Severity } from "@/lib/types";
import { SEVERITY_COLOR } from "@/components/severity-badge";

const AXIS = { stroke: "#4a5568", fontSize: 11, fill: "#8b94a3" } as const;
const PRIMARY = "#22b8e0";
const GRID = "#1f2630";

interface TooltipRow {
  name?: string;
  value?: number | string;
  color?: string;
}

function ChartTooltip({ active, payload, label, formatter }: { active?: boolean; payload?: TooltipRow[]; label?: string | number; formatter?: (v: number | string, name: string) => string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-border bg-panel-elevated px-3 py-2 text-xs shadow-xl shadow-black/40">
      {label !== undefined && <div className="mb-1 font-medium text-foreground">{label}</div>}
      {payload.map((p, i) => (
        <div key={i} className="flex items-center justify-between gap-4 text-muted-foreground">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-sm" style={{ background: p.color }} />
            {p.name}
          </span>
          <span className="tabular-nums font-medium text-foreground">{formatter ? formatter(p.value ?? 0, p.name ?? "") : p.value}</span>
        </div>
      ))}
    </div>
  );
}

export function EventsOverTimeChart({ data, height = 220 }: { data: TimeBucket[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <AreaChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <defs>
          <linearGradient id="fillTotal" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={PRIMARY} stopOpacity={0.35} />
            <stop offset="100%" stopColor={PRIMARY} stopOpacity={0.02} />
          </linearGradient>
          <linearGradient id="fillSuspicious" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#f76b15" stopOpacity={0.45} />
            <stop offset="100%" stopColor="#f76b15" stopOpacity={0.04} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={Math.max(0, Math.floor(data.length / 8) - 1)} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#2a3340" }} />
        <Area type="monotone" dataKey="total" name="Events" stroke={PRIMARY} strokeWidth={1.5} fill="url(#fillTotal)" isAnimationActive={false} />
        <Area type="monotone" dataKey="suspicious" name="Suspicious" stroke="#f76b15" strokeWidth={1.5} fill="url(#fillSuspicious)" isAnimationActive={false} />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RiskOverTimeChart({ data, height = 220 }: { data: TimeBucket[]; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <LineChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="hour" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} interval={Math.max(0, Math.floor(data.length / 8) - 1)} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} domain={[0, 100]} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ stroke: "#2a3340" }} />
        <Line type="monotone" dataKey="maxRisk" name="Peak risk" stroke="#e5484d" strokeWidth={1.5} dot={false} isAnimationActive={false} />
        <Line type="monotone" dataKey="avgRisk" name="Average risk" stroke={PRIMARY} strokeWidth={1.5} dot={false} isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function SeverityBarChart({ data, height = 200 }: { data: Array<{ severity: Severity; count: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={8}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey="severity" tick={AXIS} tickLine={false} axisLine={false} width={68} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="count" name="Events" radius={[0, 3, 3, 0]} isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.severity} fill={SEVERITY_COLOR[d.severity]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

export function HorizontalBarChart({
  data,
  dataKey,
  nameKey,
  height = 260,
  color = PRIMARY,
  secondaryKey,
  secondaryColor = "#f76b15",
  secondaryName,
  name = "Count",
}: {
  data: Array<Record<string, string | number>>;
  dataKey: string;
  nameKey: string;
  height?: number;
  color?: string;
  secondaryKey?: string;
  secondaryColor?: string;
  secondaryName?: string;
  name?: string;
}) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, left: 8, bottom: 0 }} barCategoryGap={6}>
        <CartesianGrid stroke={GRID} horizontal={false} />
        <XAxis type="number" tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} />
        <YAxis type="category" dataKey={nameKey} tick={AXIS} tickLine={false} axisLine={false} width={136} interval={0} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey={dataKey} name={name} fill={color} radius={[0, 3, 3, 0]} isAnimationActive={false} />
        {secondaryKey && <Bar dataKey={secondaryKey} name={secondaryName ?? secondaryKey} fill={secondaryColor} radius={[0, 3, 3, 0]} isAnimationActive={false} />}
      </BarChart>
    </ResponsiveContainer>
  );
}

export function SimpleBarChart({ data, xKey, yKey, height = 200, color = PRIMARY, name = "Count" }: { data: Array<Record<string, string | number>>; xKey: string; yKey: string; height?: number; color?: string; name?: string }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={10}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey={xKey} tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey={yKey} name={name} fill={color} radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function StackedSeverityIncidentsChart({ data, height = 200 }: { data: Array<{ severity: Severity; open: number; resolved: number }>; height?: number }) {
  return (
    <ResponsiveContainer width="100%" height={height}>
      <BarChart data={data} margin={{ top: 8, right: 8, left: -18, bottom: 0 }} barCategoryGap={14}>
        <CartesianGrid stroke={GRID} vertical={false} />
        <XAxis dataKey="severity" tick={AXIS} tickLine={false} axisLine={{ stroke: GRID }} />
        <YAxis tick={AXIS} tickLine={false} axisLine={false} allowDecimals={false} width={44} />
        <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgba(255,255,255,0.03)" }} />
        <Bar dataKey="open" name="Open" stackId="a" isAnimationActive={false}>
          {data.map((d) => (
            <Cell key={d.severity} fill={SEVERITY_COLOR[d.severity]} />
          ))}
        </Bar>
        <Bar dataKey="resolved" name="Closed" stackId="a" fill="#2a3340" radius={[3, 3, 0, 0]} isAnimationActive={false} />
      </BarChart>
    </ResponsiveContainer>
  );
}
