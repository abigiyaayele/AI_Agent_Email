"use client";

import { useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, ComposedChart, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const axis = { fontSize: 11, fill: "var(--muted)" };
const tooltipStyle = { background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--fg)" };
const fmt = (m: number) => (m >= 60 ? `${Math.floor(m / 60)}h ${Math.round(m % 60)}m` : `${Math.round(m)}m`);
const durationTick = (m: number) => (m === 0 ? "0" : m % 60 === 0 ? `${m / 60}h` : `${m}m`);

/** Round tick values for a minutes axis: 15/30 min steps for short spans, whole hours otherwise. */
function minuteTicks(max: number): number[] {
  const steps = [15, 30, 60, 120, 180, 240, 360, 480, 720];
  const step = steps.find((st) => max / st <= 5) ?? 1440;
  const top = Math.max(step, Math.ceil(max / step) * step);
  return Array.from({ length: top / step + 1 }, (_, i) => i * step);
}

/** Focus time per day (bars) against the time estimated for that day's planned tasks (line). Click a day to drill in. */
export function FocusChart({ data }: { data: { date: string; label: string; focus: number; planned: number }[] }) {
  const router = useRouter();
  const ticks = minuteTicks(Math.max(0, ...data.map((d) => Math.max(d.focus, d.planned))));
  return (
    <div className="h-64 w-full" role="img" aria-label="Focus time and estimated time per day">
      <ResponsiveContainer>
        <ComposedChart
          data={data}
          margin={{ top: 8, right: 8, bottom: 0, left: -8 }}
          onClick={(e) => {
            const d = data[Number(e?.activeTooltipIndex ?? -1)];
            if (d) router.push(`/time?view=day&date=${d.date}`);
          }}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval="preserveStartEnd" minTickGap={12} />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={durationTick} ticks={ticks} domain={[0, ticks.at(-1)!]} width={44} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} formatter={(v, name) => [fmt(Number(v)), name]} />
          <Legend wrapperStyle={{ fontSize: 12, color: "var(--muted)" }} iconType="plainline" />
          <Bar dataKey="focus" name="Focus time" fill="var(--series-1)" radius={[4, 4, 0, 0]} maxBarSize={28} cursor="pointer" />
          <Line dataKey="planned" name="Estimated for planned tasks" stroke="var(--series-2)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 5 }} type="linear" isAnimationActive={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Weekly completion rate of planned tasks (weeks with nothing planned are gaps, not zeros). */
export function CompletionChart({ data }: { data: { start: string; label: string; completionRate: number | null; planned: number; completed: number }[] }) {
  const router = useRouter();
  return (
    <div className="h-56 w-full" role="img" aria-label="Weekly completion rate">
      <ResponsiveContainer>
        <LineChart
          data={data}
          margin={{ top: 8, right: 12, bottom: 0, left: -8 }}
          onClick={(e) => {
            const d = data[Number(e?.activeTooltipIndex ?? -1)];
            if (d) router.push(`/plan/week?date=${d.start}`);
          }}
        >
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" width={44} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, _n, item) => {
              const p = item?.payload as { planned: number; completed: number };
              return [`${v}% (${p.completed} of ${p.planned})`, "Completed"];
            }}
          />
          <Line dataKey="completionRate" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} connectNulls={false} cursor="pointer" type="linear" isAnimationActive={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** When focus happens: minutes by local hour of day. */
export function HourChart({ data }: { data: { hour: number; focus: number }[] }) {
  const ticks = minuteTicks(Math.max(0, ...data.map((d) => d.focus)));
  return (
    <div className="h-48 w-full" role="img" aria-label="Focus time by hour of day">
      <ResponsiveContainer>
        <BarChart data={data.map((d) => ({ ...d, label: String(d.hour).padStart(2, "0") }))} margin={{ top: 8, right: 8, bottom: 0, left: -8 }} barCategoryGap={2}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="label" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} interval={2} />
          <YAxis tick={axis} tickLine={false} axisLine={false} tickFormatter={durationTick} ticks={ticks} domain={[0, ticks.at(-1)!]} width={44} />
          <Tooltip contentStyle={tooltipStyle} cursor={{ fill: "var(--surface-2)" }} labelFormatter={(l) => `${l}:00–${l}:59`} formatter={(v) => [fmt(Number(v)), "Focus"]} />
          <Bar dataKey="focus" fill="var(--series-1)" radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export function GoalHistoryChart({ data, unit }: { data: { at: string; pct: number; value: number | null }[]; unit: string }) {
  if (data.length < 2) return <p className="text-sm text-muted">This goal needs at least two progress updates to draw a trend.</p>;
  return (
    <div className="h-56 w-full" role="img" aria-label="Goal progress over time">
      <ResponsiveContainer>
        <LineChart data={data} margin={{ top: 8, right: 12, bottom: 0, left: -8 }}>
          <CartesianGrid stroke="var(--border)" vertical={false} />
          <XAxis dataKey="at" tick={axis} tickLine={false} axisLine={{ stroke: "var(--border)" }} />
          <YAxis domain={[0, 100]} tick={axis} tickLine={false} axisLine={false} unit="%" width={44} />
          <Tooltip
            contentStyle={tooltipStyle}
            formatter={(v, _n, item) => {
              const val = (item?.payload as { value: number | null }).value;
              return [`${v}%${val !== null ? ` (${val} ${unit})` : ""}`, "Progress"];
            }}
          />
          <Line dataKey="pct" stroke="var(--series-1)" strokeWidth={2} dot={{ r: 4 }} activeDot={{ r: 6 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
