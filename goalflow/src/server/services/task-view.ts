import { and, asc, eq, inArray } from "drizzle-orm";
import type { TaskItem } from "@/components/tasks/task-list";
import type { GoalOption } from "@/components/tasks/task-form";
import { formatInstant } from "@/lib/domain/periods";
import { isOverdue, toLocalInputValue } from "@/lib/domain/tasks";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import type { SessionRow } from "@/components/tasks/task-detail-client";
import { elapsedMinutes } from "@/lib/domain/timer";

/** Shape a task row for client list components (dates pre-formatted in the user's zone). */
export function toTaskItem(row: { task: s.Task; goalTitle: string | null }, tz: string, now = new Date()): TaskItem {
  const t = row.task;
  let when: string | null = null;
  if (t.scheduledStart) {
    when = `${formatInstant(t.scheduledStart, tz, "EEE d LLL, HH:mm")}${t.scheduledEnd ? `–${formatInstant(t.scheduledEnd, tz, "HH:mm")}` : ""}`;
  } else if (t.dueAt) {
    when = `Due ${formatInstant(t.dueAt, tz, "EEE d LLL")}`;
  }
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    goalTitle: row.goalTitle,
    goalId: t.goalId,
    when,
    overdue: isOverdue(t, now),
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes: t.actualMinutes,
    carryOverCount: t.carryOverCount,
    recurring: Boolean(t.recurringRuleId || t.recurrenceParentId),
  };
}

/** Open goals (with milestones) for task linking dropdowns. */
export async function goalOptions(userId: string): Promise<GoalOption[]> {
  const goals = await db()
    .select({ id: s.goals.id, title: s.goals.title, level: s.goals.level })
    .from(s.goals)
    .where(and(eq(s.goals.userId, userId), inArray(s.goals.status, ["active", "not_started", "on_hold"])))
    .orderBy(asc(s.goals.startDate), asc(s.goals.sortOrder));
  const ms = await db()
    .select({ id: s.goalMilestones.id, title: s.goalMilestones.title, goalId: s.goalMilestones.goalId })
    .from(s.goalMilestones)
    .where(eq(s.goalMilestones.userId, userId));
  return goals.map((g) => ({ ...g, milestones: ms.filter((m) => m.goalId === g.id) }));
}


export function toSessionRow(w: s.WorkSession, tz: string, taskTitle?: string | null): SessionRow {
  return {
    id: w.id,
    kind: w.kind,
    source: w.source,
    start: toLocalInputValue(w.startedAt, tz),
    end: w.endedAt ? toLocalInputValue(w.endedAt, tz) : "",
    startLabel: formatInstant(w.startedAt, tz, "EEE d LLL HH:mm"),
    endLabel: w.endedAt ? formatInstant(w.endedAt, tz, "HH:mm") : null,
    minutes: elapsedMinutes({ startedAt: w.startedAt, endedAt: w.endedAt, pausedAt: w.pausedAt, pausedMs: w.pausedMs }),
    note: w.note,
    taskId: w.taskId,
    taskTitle,
  };
}
