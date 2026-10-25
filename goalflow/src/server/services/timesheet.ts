import { and, eq, inArray } from "drizzle-orm";
import { dayBounds, formatInstant } from "@/lib/domain/periods";
import { minutesWithin } from "@/lib/domain/timer";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { sessionsInRange } from "./timer";

export type TimesheetRow = { key: string; label: string; focus: number; breaks: number; href?: string };

/**
 * Aggregate recorded time for a list of local dates. Sessions that cross midnight (or the range
 * edge) are split proportionally, so totals per day always add up.
 */
export async function buildTimesheet(userId: string, tz: string, dates: string[], now = new Date()) {
  const from = dayBounds(dates[0]!, tz).start;
  const to = dayBounds(dates[dates.length - 1]!, tz).end;
  const rows = await sessionsInRange(userId, from, to);
  const goalIds = [...new Set(rows.map((r) => r.goalId).filter((g): g is string => Boolean(g)))];
  const goals = goalIds.length
    ? await db().select({ id: s.goals.id, title: s.goals.title }).from(s.goals).where(and(eq(s.goals.userId, userId), inArray(s.goals.id, goalIds)))
    : [];
  const goalTitle = new Map(goals.map((g) => [g.id, g.title]));

  const byDay = new Map<string, TimesheetRow>(dates.map((d) => [d, { key: d, label: d, focus: 0, breaks: 0 }]));
  const byTask = new Map<string, TimesheetRow>();
  const byGoal = new Map<string, TimesheetRow>();
  let focus = 0;
  let breaks = 0;
  for (const r of rows) {
    const w = r.session;
    const state = { startedAt: w.startedAt, endedAt: w.endedAt, pausedAt: w.pausedAt, pausedMs: w.pausedMs };
    for (const d of dates) {
      const b = dayBounds(d, tz);
      const m = minutesWithin(state, b.start, b.end, now);
      if (!m) continue;
      const field = w.kind === "break" ? "breaks" : "focus";
      byDay.get(d)![field] += m;
      if (field === "focus") focus += m;
      else breaks += m;
      const taskKey = w.taskId ?? "none";
      const t = byTask.get(taskKey) ?? { key: taskKey, label: r.taskTitle ?? (w.kind === "break" ? "Breaks" : "No task"), focus: 0, breaks: 0, href: w.taskId ? `/tasks/${w.taskId}` : undefined };
      t[field] += m;
      byTask.set(taskKey, t);
      const goalKey = r.goalId ?? "none";
      const g = byGoal.get(goalKey) ?? { key: goalKey, label: r.goalId ? (goalTitle.get(r.goalId) ?? "Goal") : "Not linked to a goal", focus: 0, breaks: 0, href: r.goalId ? `/goals/${r.goalId}` : undefined };
      g[field] += m;
      byGoal.set(goalKey, g);
    }
  }
  const sortDesc = (a: TimesheetRow, b: TimesheetRow) => b.focus + b.breaks - (a.focus + a.breaks);
  return {
    sessions: rows,
    focus,
    breaks,
    days: [...byDay.values()],
    tasks: [...byTask.values()].sort(sortDesc),
    goals: [...byGoal.values()].sort(sortDesc),
  };
}

/** CSV of every session in the range, in the user's local time. */
export function timesheetCsv(sessions: Awaited<ReturnType<typeof sessionsInRange>>, tz: string, now = new Date()) {
  const esc = (v: string) => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const lines = ["date,start,end,minutes,type,source,task,note"];
  for (const r of [...sessions].reverse()) {
    const w = r.session;
    const state = { startedAt: w.startedAt, endedAt: w.endedAt, pausedAt: w.pausedAt, pausedMs: w.pausedMs };
    lines.push(
      [
        formatInstant(w.startedAt, tz, "yyyy-MM-dd"),
        formatInstant(w.startedAt, tz, "HH:mm"),
        w.endedAt ? formatInstant(w.endedAt, tz, "HH:mm") : "running",
        String(minutesWithin(state, w.startedAt, w.endedAt ?? now, now)),
        w.kind,
        w.source,
        esc(r.taskTitle ?? ""),
        esc(w.note),
      ].join(","),
    );
  }
  return lines.join("\n") + "\n";
}
