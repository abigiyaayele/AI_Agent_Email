import { and, asc, eq, gte, inArray, lt, or, sql } from "drizzle-orm";
import { dayBounds, eachDate, formatInstant, periodContaining, subPeriods } from "@/lib/domain/periods";
import { estimationAccuracy } from "@/lib/domain/estimation";
import { computePeriodMetrics, type ReviewSession, type ReviewTask } from "@/lib/domain/review";
import { minutesWithin } from "@/lib/domain/timer";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";

type Prefs = s.Preferences;

/** Dashboard analytics for a local date range, computed only from the user's stored records. */
export async function analytics(userId: string, prefs: Prefs, from: string, to: string, goalId?: string, now = new Date()) {
  const tz = prefs.timezone;
  const start = dayBounds(from, tz).start;
  const end = dayBounds(to, tz).end;
  const dates = eachDate(from, to);

  const [tasks, sessions, goals] = await Promise.all([
    db()
      .select()
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.userId, userId),
          or(
            and(gte(sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt})`, start), lt(sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt})`, end)),
            and(gte(s.tasks.completedAt, start), lt(s.tasks.completedAt, end)),
          ),
        ),
      ),
    db()
      .select()
      .from(s.workSessions)
      .where(and(eq(s.workSessions.userId, userId), lt(s.workSessions.startedAt, end), or(sql`${s.workSessions.endedAt} is null`, sql`${s.workSessions.endedAt} > ${start}`))),
    db().select({ id: s.goals.id, title: s.goals.title, category: s.goals.category, level: s.goals.level }).from(s.goals).where(eq(s.goals.userId, userId)).orderBy(asc(s.goals.startDate)),
  ]);

  const goalById = new Map(goals.map((g) => [g.id, g]));
  const taskGoal = new Map(tasks.map((t) => [t.id, t.goalId]));
  // Sessions may reference tasks outside the range (worked on early); look those up too.
  const missing = [...new Set(sessions.map((w) => w.taskId).filter((id): id is string => Boolean(id) && !taskGoal.has(id!)))];
  if (missing.length) {
    const extra = await db().select({ id: s.tasks.id, goalId: s.tasks.goalId }).from(s.tasks).where(and(eq(s.tasks.userId, userId), inArray(s.tasks.id, missing)));
    for (const e of extra) taskGoal.set(e.id, e.goalId);
  }

  const perDay = dates.map((d) => {
    const b = dayBounds(d, tz);
    let focus = 0;
    for (const w of sessions) if (w.kind === "focus") focus += minutesWithin(w, b.start, b.end, now);
    const planned = tasks
      .filter((t) => {
        const a = t.scheduledStart ?? t.dueAt;
        return a && a >= b.start && a < b.end && t.status !== "deferred";
      })
      .reduce((sum, t) => sum + (t.estimatedMinutes ?? 0), 0);
    const completed = tasks.filter((t) => t.completedAt && t.completedAt >= b.start && t.completedAt < b.end).length;
    return { date: d, focus, planned, completed };
  });

  const byHour = Array.from({ length: 24 }, (_, h) => ({ hour: h, focus: 0 }));
  const byCategory = new Map<string, number>();
  const byGoal = new Map<string, number>();
  for (const w of sessions) {
    if (w.kind !== "focus") continue;
    const m = minutesWithin(w, start, end, now);
    if (!m) continue;
    // Attribute to the local start hour; long sessions are split hour by hour.
    let cursor = new Date(Math.max(w.startedAt.getTime(), start.getTime()));
    const stop = new Date(Math.min((w.endedAt ?? w.pausedAt ?? now).getTime(), end.getTime()));
    const ratio = m / Math.max(1, (stop.getTime() - cursor.getTime()) / 60_000);
    let guard = 0;
    while (cursor < stop && guard++ < 1000) {
      const h = Number(formatInstant(cursor, tz, "H"));
      const nextHour = new Date(cursor.getTime() + (60 - Number(formatInstant(cursor, tz, "m"))) * 60_000 - cursor.getSeconds() * 1000);
      const seg = Math.min(stop.getTime(), nextHour.getTime()) - cursor.getTime();
      byHour[h]!.focus += (seg / 60_000) * ratio;
      cursor = new Date(cursor.getTime() + seg);
    }
    const gid = w.taskId ? (taskGoal.get(w.taskId) ?? null) : null;
    const cat = gid ? (goalById.get(gid)?.category ?? "other") : "unlinked";
    byCategory.set(cat, (byCategory.get(cat) ?? 0) + m);
    if (gid) byGoal.set(gid, (byGoal.get(gid) ?? 0) + m);
  }
  byHour.forEach((h) => (h.focus = Math.round(h.focus)));

  const reviewTasks: ReviewTask[] = tasks.map((t) => ({ ...t }));
  const reviewSessions: ReviewSession[] = sessions.map((w) => ({ ...w }));
  const weeks = subPeriods({ ...periodContaining("week", from, tz, prefs.weekStartsOn), end: to, type: "week" }, "week", tz, prefs.weekStartsOn).map((p) => {
    const m = computePeriodMetrics({ tasks: reviewTasks, sessions: reviewSessions, goals: [], goalCategory: new Map() }, p.startInstant, p.endExclusive, now);
    return { start: p.start, label: formatInstant(p.startInstant, tz, "d LLL"), completionRate: m.planned ? m.completionRate : null, planned: m.planned, completed: m.completedPlanned };
  });

  const done = tasks.filter((t) => t.status === "done" && t.completedAt && t.completedAt >= start && t.completedAt < end);
  const accuracy = estimationAccuracy(done);
  const overruns = done
    .filter((t) => (t.estimatedMinutes ?? 0) > 0 && t.actualMinutes > 0)
    .map((t) => ({ id: t.id, title: t.title, estimated: t.estimatedMinutes!, actual: t.actualMinutes, ratio: t.actualMinutes / t.estimatedMinutes! }))
    .sort((a, b) => Math.abs(Math.log(b.ratio)) - Math.abs(Math.log(a.ratio)))
    .slice(0, 8);

  const planned = tasks.filter((t) => {
    const a = t.scheduledStart ?? t.dueAt;
    return a && a >= start && a < end;
  });
  const statusCounts = {
    planned: planned.length,
    done: planned.filter((t) => t.status === "done").length,
    carried: planned.filter((t) => t.carryOverCount > 0).length,
    deferred: planned.filter((t) => t.status === "deferred").length,
    blocked: planned.filter((t) => t.status === "blocked").length,
    overdue: planned.filter((t) => t.status !== "done" && t.status !== "deferred" && t.dueAt && t.dueAt < now).length,
  };

  const selectedGoal = goalId ? goalById.get(goalId) : undefined;
  const snapshots = selectedGoal
    ? await db()
        .select({ at: s.progressSnapshots.capturedAt, pct: s.progressSnapshots.progressPct, value: s.progressSnapshots.value })
        .from(s.progressSnapshots)
        .where(and(eq(s.progressSnapshots.userId, userId), eq(s.progressSnapshots.goalId, selectedGoal.id)))
        .orderBy(asc(s.progressSnapshots.capturedAt))
    : [];

  const totalFocus = perDay.reduce((a, d) => a + d.focus, 0);
  return {
    perDay,
    byHour,
    weeks,
    categories: [...byCategory.entries()].map(([key, minutes]) => ({ key, minutes })).sort((a, b) => b.minutes - a.minutes),
    goalTime: [...byGoal.entries()]
      .map(([id, minutes]) => ({ id, title: goalById.get(id)?.title ?? "Goal", minutes }))
      .sort((a, b) => b.minutes - a.minutes)
      .slice(0, 10),
    accuracy,
    overruns,
    statusCounts,
    totalFocus,
    activeDays: perDay.filter((d) => d.focus > 0).length,
    goals,
    selectedGoal: selectedGoal ?? null,
    snapshots: snapshots.map((p) => ({ at: formatInstant(p.at, tz, "d LLL"), pct: Math.round(p.pct * 10) / 10, value: p.value })),
  };
}
