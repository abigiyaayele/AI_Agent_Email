import type { GoalCategory, Priority, TaskStatus } from "@/lib/constants";
import { minutesWithin, type TimerState } from "./timer";

export type ReviewTask = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  goalId: string | null;
  scheduledStart: Date | null;
  dueAt: Date | null;
  completedAt: Date | null;
  estimatedMinutes: number | null;
  actualMinutes: number;
  carryOverCount: number;
};
export type ReviewSession = TimerState & { taskId: string | null; kind: "focus" | "break" };
export type ReviewGoal = { id: string; title: string; category: GoalCategory; level: string; pct: number; expectedPct: number };

export type PeriodMetrics = {
  planned: number;
  completed: number;
  completedPlanned: number;
  completionRate: number;
  onTimeRate: number | null;
  unfinished: { id: string; title: string; status: TaskStatus; priority: Priority; carryOverCount: number }[];
  done: { id: string; title: string; actualMinutes: number; estimatedMinutes: number | null }[];
  plannedMinutes: number;
  focusMinutes: number;
  breakMinutes: number;
  minutesByCategory: Record<string, number>;
  minutesByGoal: Record<string, number>;
  deferred: number;
  blocked: number;
  carriedOver: number;
  goals: ReviewGoal[];
};

const inRange = (d: Date | null, from: Date, to: Date) => d !== null && d >= from && d < to;

/**
 * Aggregate stored records for a period. Everything here is computed from real rows: tasks
 * planned in the window (scheduled or due), tasks completed in it, and focus sessions clipped to it.
 */
export function computePeriodMetrics(
  input: { tasks: ReviewTask[]; sessions: ReviewSession[]; goals: ReviewGoal[]; goalCategory: Map<string, GoalCategory> },
  from: Date,
  to: Date,
  now: Date = new Date(),
): PeriodMetrics {
  const plannedTasks = input.tasks.filter((t) => inRange(t.scheduledStart ?? t.dueAt, from, to));
  const completedPlanned = plannedTasks.filter((t) => t.status === "done");
  // Done = finished during the period, plus work planned for it that was finished early.
  const completedIds = new Set(input.tasks.filter((t) => t.status === "done" && inRange(t.completedAt, from, to)).map((t) => t.id));
  completedPlanned.forEach((t) => completedIds.add(t.id));
  const completedTasks = input.tasks.filter((t) => completedIds.has(t.id));
  const withDue = completedTasks.filter((t) => t.dueAt);
  const onTime = withDue.filter((t) => t.completedAt! <= t.dueAt!).length;

  const minutesByCategory: Record<string, number> = {};
  const minutesByGoal: Record<string, number> = {};
  const taskGoal = new Map(input.tasks.map((t) => [t.id, t.goalId]));
  let focus = 0;
  let breaks = 0;
  for (const s of input.sessions) {
    const m = minutesWithin(s, from, to, now);
    if (m <= 0) continue;
    if (s.kind === "break") {
      breaks += m;
      continue;
    }
    focus += m;
    const goalId = s.taskId ? taskGoal.get(s.taskId) ?? null : null;
    const cat = goalId ? input.goalCategory.get(goalId) ?? "other" : "unlinked";
    minutesByCategory[cat] = (minutesByCategory[cat] ?? 0) + m;
    if (goalId) minutesByGoal[goalId] = (minutesByGoal[goalId] ?? 0) + m;
  }

  return {
    planned: plannedTasks.length,
    completed: completedTasks.length,
    completedPlanned: completedPlanned.length,
    completionRate: plannedTasks.length ? Math.round((completedPlanned.length / plannedTasks.length) * 1000) / 10 : 0,
    onTimeRate: withDue.length ? Math.round((onTime / withDue.length) * 1000) / 10 : null,
    unfinished: plannedTasks
      .filter((t) => t.status !== "done")
      .map((t) => ({ id: t.id, title: t.title, status: t.status, priority: t.priority, carryOverCount: t.carryOverCount })),
    done: completedTasks.map((t) => ({ id: t.id, title: t.title, actualMinutes: t.actualMinutes, estimatedMinutes: t.estimatedMinutes })),
    plannedMinutes: plannedTasks.reduce((s, t) => s + (t.estimatedMinutes ?? 0), 0),
    focusMinutes: focus,
    breakMinutes: breaks,
    minutesByCategory,
    minutesByGoal,
    deferred: plannedTasks.filter((t) => t.status === "deferred").length,
    blocked: plannedTasks.filter((t) => t.status === "blocked").length,
    carriedOver: plannedTasks.filter((t) => t.carryOverCount > 0).length,
    goals: input.goals,
  };
}

/**
 * Deterministic summary used when no AI provider is configured (and as grounding for the AI).
 */
export function ruleBasedSummary(
  label: string,
  m: PeriodMetrics,
  notes: { title: string; body: string }[] = [],
): string {
  const lines: string[] = [];
  lines.push(
    `${label}: ${m.completed} task${m.completed === 1 ? "" : "s"} completed` +
      (m.planned ? `, ${m.completedPlanned} of ${m.planned} planned (${m.completionRate}%).` : "."),
  );
  const fmt = (min: number) => (min >= 60 ? `${Math.floor(min / 60)}h ${min % 60}m` : `${min}m`);
  lines.push(
    `Focused time: ${fmt(m.focusMinutes)}${m.plannedMinutes ? ` against ${fmt(m.plannedMinutes)} estimated` : ""}${m.breakMinutes ? `, plus ${fmt(m.breakMinutes)} of breaks` : ""}.`,
  );
  if (m.done.length) lines.push(`Done: ${m.done.slice(0, 8).map((t) => t.title).join("; ")}${m.done.length > 8 ? "; …" : ""}.`);
  if (m.unfinished.length) {
    lines.push(
      `Not finished: ${m.unfinished
        .slice(0, 8)
        .map((t) => `${t.title} (${t.status.replace("_", " ")})`)
        .join("; ")}${m.unfinished.length > 8 ? "; …" : ""}.`,
    );
  }
  if (m.onTimeRate !== null) lines.push(`On-time completion: ${m.onTimeRate}%.`);
  if (m.blocked) lines.push(`${m.blocked} task${m.blocked === 1 ? " is" : "s are"} blocked; resolve or re-plan them.`);
  if (m.carriedOver) lines.push(`${m.carriedOver} task${m.carriedOver === 1 ? " has" : "s have"} been carried over before; consider splitting or re-estimating.`);
  const behind = m.goals.filter((g) => g.pct + 10 < g.expectedPct);
  if (behind.length) lines.push(`Behind pace: ${behind.map((g) => `${g.title} (${g.pct}% vs ${g.expectedPct}% expected)`).join("; ")}.`);
  if (notes.length) lines.push(`Notes captured: ${notes.slice(0, 5).map((n) => n.title || n.body.slice(0, 60)).join("; ")}.`);
  const top = m.unfinished.filter((t) => t.priority === "critical" || t.priority === "high").slice(0, 3);
  if (top.length) lines.push(`Next priorities: ${top.map((t) => t.title).join("; ")}.`);
  return lines.join("\n");
}
