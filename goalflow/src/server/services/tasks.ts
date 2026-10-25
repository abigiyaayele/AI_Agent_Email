import { and, asc, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, ne, notInArray, or, sql, type SQL } from "drizzle-orm";
import { PRIORITY_RANK, type Priority, type TaskStatus } from "@/lib/constants";
import { remainingMinutes } from "@/lib/domain/estimation";
import { dayBounds, formatInstant, instantToLocal, localToInstant } from "@/lib/domain/periods";
import { occurrencesBetween } from "@/lib/domain/recurrence";
import { commitmentsOn, findConflicts, type Interval } from "@/lib/domain/scheduling";
import { carryOverPatch, parseLocalDateTime, statusPatch, TransitionError } from "@/lib/domain/tasks";
import type { QuickTaskSchema, TaskInput } from "@/lib/validation/task";
import type { z } from "zod";
import { db, type Executor } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "./audit";
import { syncTaskReminders } from "./reminders";

export class TaskError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export class ConflictError extends Error {
  constructor(public conflicts: { label: string; start: Date; end: Date }[]) {
    super("This time overlaps other scheduled items.");
  }
}

type Prefs = s.Preferences;

const OPEN: TaskStatus[] = ["todo", "in_progress", "blocked"];

/** Overlap check against other open scheduled tasks and recurring commitments. */
export async function findScheduleConflicts(
  ex: Executor,
  userId: string,
  tz: string,
  candidate: { id?: string; start: Date; end: Date },
): Promise<Interval[]> {
  const others = await ex
    .select({ id: s.tasks.id, title: s.tasks.title, start: s.tasks.scheduledStart, end: s.tasks.scheduledEnd })
    .from(s.tasks)
    .where(
      and(
        eq(s.tasks.userId, userId),
        inArray(s.tasks.status, OPEN),
        isNotNull(s.tasks.scheduledStart),
        isNotNull(s.tasks.scheduledEnd),
        lt(s.tasks.scheduledStart, candidate.end),
        sql`${s.tasks.scheduledEnd} > ${candidate.start}`,
        candidate.id ? ne(s.tasks.id, candidate.id) : undefined,
      ),
    );
  const commitments = await ex.select().from(s.schedules).where(eq(s.schedules.userId, userId));
  const days = new Set([instantToLocal(candidate.start, tz).date, instantToLocal(new Date(candidate.end.getTime() - 1), tz).date]);
  const busy: Interval[] = [
    ...others.map((o) => ({ id: o.id, label: o.title, start: o.start!, end: o.end!, kind: "task" as const })),
    ...[...days].flatMap((d) => commitmentsOn(d, tz, commitments)),
  ];
  return findConflicts({ id: candidate.id ?? "new", label: "", start: candidate.start, end: candidate.end }, busy);
}

async function assertLinks(ex: Executor, userId: string, input: { goalId: string | null; milestoneId: string | null; parentTaskId: string | null }) {
  if (input.goalId) {
    const [g] = await ex.select({ id: s.goals.id }).from(s.goals).where(and(eq(s.goals.id, input.goalId), eq(s.goals.userId, userId)));
    if (!g) throw new TaskError("Linked goal not found.", "goalId");
  }
  if (input.milestoneId) {
    const [m] = await ex
      .select({ goalId: s.goalMilestones.goalId })
      .from(s.goalMilestones)
      .where(and(eq(s.goalMilestones.id, input.milestoneId), eq(s.goalMilestones.userId, userId)));
    if (!m) throw new TaskError("Linked milestone not found.", "milestoneId");
    if (input.goalId && m.goalId !== input.goalId) throw new TaskError("That milestone belongs to a different goal.", "milestoneId");
  }
  if (input.parentTaskId) {
    const [p] = await ex.select({ id: s.tasks.id }).from(s.tasks).where(and(eq(s.tasks.id, input.parentTaskId), eq(s.tasks.userId, userId)));
    if (!p) throw new TaskError("Parent task not found.", "parentTaskId");
  }
}

function scheduleFrom(input: TaskInput, tz: string) {
  const scheduledStart = parseLocalDateTime(input.scheduledStart, tz);
  const minutes = input.durationMinutes ?? input.estimatedMinutes ?? null;
  const scheduledEnd = scheduledStart && minutes ? new Date(scheduledStart.getTime() + minutes * 60_000) : null;
  return { scheduledStart, scheduledEnd, dueAt: parseLocalDateTime(input.dueAt, tz) };
}

const fmtConflicts = (c: Interval[], tz: string) => c.map((x) => ({ label: x.label, start: x.start, end: x.end, tz }));

async function upsertRule(ex: Executor, userId: string, input: TaskInput, tz: string, existingRuleId: string | null) {
  if (input.recurrenceFreq === "none") {
    return null;
  }
  const values = {
    userId,
    freq: input.recurrenceFreq,
    interval: input.recurrenceInterval,
    byWeekday: input.recurrenceFreq === "weekly" && input.recurrenceDays.length ? input.recurrenceDays : null,
    byMonthDay: null,
    startLocal: input.scheduledStart!,
    timezone: tz,
    untilDate: input.recurrenceUntil,
    count: null,
  };
  if (existingRuleId) {
    await ex.update(s.recurringRules).set(values).where(eq(s.recurringRules.id, existingRuleId));
    return existingRuleId;
  }
  const [r] = await ex.insert(s.recurringRules).values(values).returning({ id: s.recurringRules.id });
  return r!.id;
}

export async function createTask(userId: string, prefs: Prefs, input: TaskInput) {
  const tz = prefs.timezone;
  return db().transaction(async (tx) => {
    await assertLinks(tx, userId, input);
    const sched = scheduleFrom(input, tz);
    if (sched.scheduledStart && sched.scheduledEnd && !input.allowOverlap) {
      const conflicts = await findScheduleConflicts(tx, userId, tz, { start: sched.scheduledStart, end: sched.scheduledEnd });
      if (conflicts.length) throw new ConflictError(fmtConflicts(conflicts, tz));
    }
    const ruleId = await upsertRule(tx, userId, input, tz, null);
    const status = statusPatch("todo", input.status);
    const [t] = await tx
      .insert(s.tasks)
      .values({
        userId,
        title: input.title,
        description: input.description,
        notes: input.notes,
        priority: input.priority,
        goalId: input.goalId,
        milestoneId: input.milestoneId,
        parentTaskId: input.parentTaskId,
        estimatedMinutes: input.estimatedMinutes,
        remainingMinutes: input.remainingMinutes,
        allowOverlap: input.allowOverlap,
        recurringRuleId: ruleId,
        ...sched,
        ...status,
      })
      .returning();
    await syncTaskReminders(tx, userId, t!, prefs, { startOffset: input.startReminder, deadlineOffset: input.deadlineReminder });
    await audit(tx, userId, "task", t!.id, "task.created", { title: t!.title, scheduledStart: t!.scheduledStart, allowOverlap: input.allowOverlap });
    return t!;
  });
}

export async function quickAddTask(userId: string, prefs: Prefs, input: z.infer<typeof QuickTaskSchema>) {
  const tz = prefs.timezone;
  const scheduledStart = input.date && input.time ? localToInstant(input.date, input.time, tz) : null;
  const minutes = input.estimatedMinutes ?? 30;
  return db().transaction(async (tx) => {
    if (input.goalId) await assertLinks(tx, userId, { goalId: input.goalId, milestoneId: null, parentTaskId: null });
    let allowOverlap = false;
    if (scheduledStart) {
      const conflicts = await findScheduleConflicts(tx, userId, tz, { start: scheduledStart, end: new Date(scheduledStart.getTime() + minutes * 60_000) });
      if (conflicts.length) throw new ConflictError(fmtConflicts(conflicts, tz));
      allowOverlap = false;
    }
    const [t] = await tx
      .insert(s.tasks)
      .values({
        userId,
        title: input.title,
        priority: input.priority,
        goalId: input.goalId,
        estimatedMinutes: input.estimatedMinutes,
        scheduledStart,
        scheduledEnd: scheduledStart ? new Date(scheduledStart.getTime() + minutes * 60_000) : null,
        dueAt: !scheduledStart && input.date ? localToInstant(input.date, "23:59", tz) : null,
        allowOverlap,
      })
      .returning();
    await audit(tx, userId, "task", t!.id, "task.created", { title: t!.title, quick: true });
    return t!;
  });
}

export async function updateTask(userId: string, prefs: Prefs, id: string, input: TaskInput) {
  const tz = prefs.timezone;
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(s.tasks).where(and(eq(s.tasks.id, id), eq(s.tasks.userId, userId))).for("update");
    if (!existing) throw new TaskError("Task not found.");
    if (input.parentTaskId === id) throw new TaskError("A task cannot be its own subtask.", "parentTaskId");
    await assertLinks(tx, userId, input);
    const sched = scheduleFrom(input, tz);
    if (sched.scheduledStart && sched.scheduledEnd && !input.allowOverlap && input.status !== "done") {
      const conflicts = await findScheduleConflicts(tx, userId, tz, { id, start: sched.scheduledStart, end: sched.scheduledEnd });
      if (conflicts.length) throw new ConflictError(fmtConflicts(conflicts, tz));
    }
    let status;
    try {
      status = statusPatch(existing.status, input.status);
    } catch (err) {
      if (err instanceof TransitionError) throw new TaskError(err.message, "status");
      throw err;
    }
    if (existing.status === input.status) status = { status: existing.status, completedAt: existing.completedAt };
    const ruleId = await upsertRule(tx, userId, input, tz, existing.recurringRuleId);
    const [t] = await tx
      .update(s.tasks)
      .set({
        title: input.title,
        description: input.description,
        notes: input.notes,
        priority: input.priority,
        goalId: input.goalId,
        milestoneId: input.milestoneId,
        parentTaskId: input.parentTaskId,
        estimatedMinutes: input.estimatedMinutes,
        remainingMinutes: input.remainingMinutes,
        allowOverlap: input.allowOverlap,
        recurringRuleId: ruleId,
        ...sched,
        ...status,
      })
      .where(eq(s.tasks.id, id))
      .returning();
    if (existing.recurringRuleId && !ruleId) {
      await tx.delete(s.recurringRules).where(eq(s.recurringRules.id, existing.recurringRuleId));
    }
    await syncTaskReminders(tx, userId, t!, prefs, { startOffset: input.startReminder, deadlineOffset: input.deadlineReminder });
    const changed: Record<string, { from: unknown; to: unknown }> = {};
    for (const k of ["title", "status", "priority", "goalId", "scheduledStart", "dueAt", "estimatedMinutes"] as const) {
      const a = existing[k] instanceof Date ? (existing[k] as Date).toISOString() : existing[k];
      const b = t![k] instanceof Date ? (t![k] as Date).toISOString() : t![k];
      if (a !== b) changed[k] = { from: a, to: b };
    }
    if (Object.keys(changed).length) await audit(tx, userId, "task", id, "task.updated", changed);
    return t!;
  });
}

export async function setTaskStatus(userId: string, prefs: Prefs, id: string, to: TaskStatus) {
  return db().transaction(async (tx) => {
    const [t] = await tx.select().from(s.tasks).where(and(eq(s.tasks.id, id), eq(s.tasks.userId, userId))).for("update");
    if (!t) throw new TaskError("Task not found.");
    let patch;
    try {
      patch = statusPatch(t.status, to);
    } catch (err) {
      if (err instanceof TransitionError) throw new TaskError(err.message);
      throw err;
    }
    if (t.status === to) return t;
    if (to === "done") {
      const open = await tx
        .select({ title: s.tasks.title })
        .from(s.taskDependencies)
        .innerJoin(s.tasks, eq(s.tasks.id, s.taskDependencies.dependsOnTaskId))
        .where(and(eq(s.taskDependencies.taskId, id), ne(s.tasks.status, "done")));
      if (open.length) throw new TaskError(`Finish ${open.map((o) => `“${o.title}”`).join(", ")} first, or remove the dependency.`);
    }
    const [u] = await tx.update(s.tasks).set(patch).where(eq(s.tasks.id, id)).returning();
    await syncTaskReminders(tx, userId, u!, prefs, undefined);
    await audit(tx, userId, "task", id, "task.status", { from: t.status, to });
    return u!;
  });
}

/** Drag-and-drop reschedule: keeps duration; refuses overlaps unless approved. */
export async function rescheduleTask(userId: string, prefs: Prefs, id: string, start: Date | null, allowOverlap = false) {
  const tz = prefs.timezone;
  return db().transaction(async (tx) => {
    const [t] = await tx.select().from(s.tasks).where(and(eq(s.tasks.id, id), eq(s.tasks.userId, userId))).for("update");
    if (!t) throw new TaskError("Task not found.");
    const minutes = t.scheduledStart && t.scheduledEnd ? (t.scheduledEnd.getTime() - t.scheduledStart.getTime()) / 60_000 : (t.estimatedMinutes ?? 30);
    const end = start ? new Date(start.getTime() + minutes * 60_000) : null;
    if (start && end && !allowOverlap && !t.allowOverlap) {
      const conflicts = await findScheduleConflicts(tx, userId, tz, { id, start, end });
      if (conflicts.length) throw new ConflictError(fmtConflicts(conflicts, tz));
    }
    const [u] = await tx
      .update(s.tasks)
      .set({ scheduledStart: start, scheduledEnd: end, allowOverlap: allowOverlap || t.allowOverlap })
      .where(eq(s.tasks.id, id))
      .returning();
    await syncTaskReminders(tx, userId, u!, prefs, undefined);
    await audit(tx, userId, "task", id, "task.rescheduled", {
      from: t.scheduledStart?.toISOString() ?? null,
      to: start?.toISOString() ?? null,
      allowOverlap,
    });
    return u!;
  });
}

/** Move unfinished tasks to another day without losing their history. */
export async function carryOverTasks(userId: string, prefs: Prefs, ids: string[], targetDate: string) {
  const tz = prefs.timezone;
  return db().transaction(async (tx) => {
    const rows = await tx
      .select()
      .from(s.tasks)
      .where(and(eq(s.tasks.userId, userId), inArray(s.tasks.id, ids), ne(s.tasks.status, "done")))
      .for("update");
    for (const t of rows) {
      const patch = carryOverPatch(t, targetDate, tz, { moveDue: false });
      await tx.update(s.tasks).set(patch).where(eq(s.tasks.id, t.id));
      await syncTaskReminders(tx, userId, { ...t, ...patch }, prefs, undefined);
      await audit(tx, userId, "task", t.id, "task.carried_over", {
        from: (t.scheduledStart ?? t.dueAt)?.toISOString() ?? null,
        toDate: targetDate,
        count: patch.carryOverCount,
      });
    }
    return rows.length;
  });
}

export async function deleteTask(userId: string, id: string) {
  await db().transaction(async (tx) => {
    const [t] = await tx.delete(s.tasks).where(and(eq(s.tasks.id, id), eq(s.tasks.userId, userId))).returning();
    if (t?.recurringRuleId) await tx.delete(s.recurringRules).where(eq(s.recurringRules.id, t.recurringRuleId));
  });
}

// ---- recurring tasks

/**
 * Create concrete instances of recurring tasks for a window (idempotent: the unique index on
 * (recurrence_parent_id, scheduled_start) makes repeated calls safe).
 */
export async function materializeRecurring(userId: string, from: Date, to: Date) {
  const templates = await db()
    .select({ t: s.tasks, r: s.recurringRules })
    .from(s.tasks)
    .innerJoin(s.recurringRules, eq(s.recurringRules.id, s.tasks.recurringRuleId))
    .where(and(eq(s.tasks.userId, userId), isNull(s.tasks.recurrenceParentId)));
  let created = 0;
  for (const { t, r } of templates) {
    if (!t.scheduledStart) continue;
    const duration = t.scheduledEnd ? t.scheduledEnd.getTime() - t.scheduledStart.getTime() : (t.estimatedMinutes ?? 30) * 60_000;
    const occ = occurrencesBetween(
      { freq: r.freq, interval: r.interval, byWeekday: r.byWeekday, byMonthDay: r.byMonthDay, startLocal: r.startLocal, timezone: r.timezone, untilDate: r.untilDate, count: r.count },
      from,
      to,
    ).filter((d) => d.getTime() !== t.scheduledStart!.getTime());
    if (!occ.length) continue;
    const rows = await db()
      .insert(s.tasks)
      .values(
        occ.map((start) => ({
          userId,
          title: t.title,
          description: t.description,
          priority: t.priority,
          goalId: t.goalId,
          milestoneId: t.milestoneId,
          estimatedMinutes: t.estimatedMinutes,
          scheduledStart: start,
          scheduledEnd: new Date(start.getTime() + duration),
          allowOverlap: t.allowOverlap,
          recurrenceParentId: t.id,
        })),
      )
      .onConflictDoNothing()
      .returning({ id: s.tasks.id });
    created += rows.length;
  }
  return created;
}

// ---- queries

export type TaskFilters = {
  q?: string;
  status?: TaskStatus[];
  priority?: Priority;
  goalId?: string;
  view?: "all" | "today" | "overdue" | "unscheduled" | "upcoming" | "completed";
  sort?: "priority" | "due" | "start" | "created";
};

export async function listTasks(userId: string, tz: string, f: TaskFilters = {}, now = new Date()) {
  const conds: (SQL | undefined)[] = [eq(s.tasks.userId, userId)];
  if (f.q) conds.push(or(ilike(s.tasks.title, `%${f.q}%`), ilike(s.tasks.description, `%${f.q}%`)));
  if (f.status?.length) conds.push(inArray(s.tasks.status, f.status));
  if (f.priority) conds.push(eq(s.tasks.priority, f.priority));
  if (f.goalId) conds.push(eq(s.tasks.goalId, f.goalId));
  const today = dayBounds(instantToLocal(now, tz).date, tz);
  switch (f.view) {
    case "today":
      conds.push(
        or(
          and(gte(s.tasks.scheduledStart, today.start), lt(s.tasks.scheduledStart, today.end)),
          and(isNull(s.tasks.scheduledStart), gte(s.tasks.dueAt, today.start), lt(s.tasks.dueAt, today.end)),
        ),
      );
      break;
    case "overdue":
      conds.push(lt(s.tasks.dueAt, now), notInArray(s.tasks.status, ["done", "deferred"]));
      break;
    case "unscheduled":
      conds.push(isNull(s.tasks.scheduledStart), notInArray(s.tasks.status, ["done"]));
      break;
    case "upcoming":
      conds.push(gte(sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt})`, today.end), ne(s.tasks.status, "done"));
      break;
    case "completed":
      conds.push(eq(s.tasks.status, "done"));
      break;
  }
  const order =
    f.sort === "due"
      ? [sql`${s.tasks.dueAt} asc nulls last`]
      : f.sort === "start"
        ? [sql`${s.tasks.scheduledStart} asc nulls last`]
        : f.sort === "created"
          ? [desc(s.tasks.createdAt)]
          : f.view === "completed"
            ? [desc(s.tasks.completedAt)]
            : [
                sql`case ${s.tasks.priority} when 'critical' then 0 when 'high' then 1 when 'medium' then 2 else 3 end`,
                sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt}) asc nulls last`,
              ];
  return db()
    .select({ task: s.tasks, goalTitle: s.goals.title, goalCategory: s.goals.category })
    .from(s.tasks)
    .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
    .where(and(...conds))
    .orderBy(...order)
    .limit(500);
}

/** Tasks anchored (scheduled, or due if unscheduled) in a time range. */
export async function tasksInRange(userId: string, from: Date, to: Date) {
  return db()
    .select({ task: s.tasks, goalTitle: s.goals.title, goalCategory: s.goals.category })
    .from(s.tasks)
    .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
    .where(
      and(
        eq(s.tasks.userId, userId),
        or(
          and(gte(s.tasks.scheduledStart, from), lt(s.tasks.scheduledStart, to)),
          and(isNull(s.tasks.scheduledStart), gte(s.tasks.dueAt, from), lt(s.tasks.dueAt, to)),
        ),
      ),
    )
    .orderBy(sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt}) asc`);
}

export async function getTask(userId: string, id: string) {
  const [row] = await db()
    .select({ task: s.tasks, goal: s.goals, rule: s.recurringRules })
    .from(s.tasks)
    .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
    .leftJoin(s.recurringRules, eq(s.recurringRules.id, s.tasks.recurringRuleId))
    .where(and(eq(s.tasks.id, id), eq(s.tasks.userId, userId)));
  if (!row) return null;
  const [checklist, subtasks, deps, history, reminders, sessions] = await Promise.all([
    db().select().from(s.taskChecklistItems).where(eq(s.taskChecklistItems.taskId, id)).orderBy(asc(s.taskChecklistItems.sortOrder), asc(s.taskChecklistItems.createdAt)),
    db().select().from(s.tasks).where(and(eq(s.tasks.parentTaskId, id), eq(s.tasks.userId, userId))).orderBy(asc(s.tasks.createdAt)),
    db()
      .select({ id: s.tasks.id, title: s.tasks.title, status: s.tasks.status })
      .from(s.taskDependencies)
      .innerJoin(s.tasks, eq(s.tasks.id, s.taskDependencies.dependsOnTaskId))
      .where(and(eq(s.taskDependencies.taskId, id), eq(s.taskDependencies.userId, userId))),
    db()
      .select()
      .from(s.auditEvents)
      .where(and(eq(s.auditEvents.entityType, "task"), eq(s.auditEvents.entityId, id), eq(s.auditEvents.userId, userId)))
      .orderBy(desc(s.auditEvents.createdAt))
      .limit(50),
    db().select().from(s.reminders).where(and(eq(s.reminders.taskId, id), eq(s.reminders.userId, userId))),
    db().select().from(s.workSessions).where(and(eq(s.workSessions.taskId, id), eq(s.workSessions.userId, userId))).orderBy(desc(s.workSessions.startedAt)),
  ]);
  const parent = row.task.parentTaskId
    ? (await db().select({ id: s.tasks.id, title: s.tasks.title }).from(s.tasks).where(eq(s.tasks.id, row.task.parentTaskId)))[0] ?? null
    : null;
  return { ...row, checklist, subtasks, deps, history, reminders, sessions, parent };
}

// ---- checklist, subtasks and dependencies

export async function addChecklistItem(userId: string, taskId: string, title: string) {
  const [t] = await db().select({ id: s.tasks.id }).from(s.tasks).where(and(eq(s.tasks.id, taskId), eq(s.tasks.userId, userId)));
  if (!t) throw new TaskError("Task not found.");
  const [{ n }] = (await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.taskChecklistItems)
    .where(eq(s.taskChecklistItems.taskId, taskId))) as [{ n: number }];
  await db().insert(s.taskChecklistItems).values({ userId, taskId, title, sortOrder: n });
}

export async function toggleChecklistItem(userId: string, id: string, done: boolean) {
  await db().update(s.taskChecklistItems).set({ done }).where(and(eq(s.taskChecklistItems.id, id), eq(s.taskChecklistItems.userId, userId)));
}

export async function deleteChecklistItem(userId: string, id: string) {
  await db().delete(s.taskChecklistItems).where(and(eq(s.taskChecklistItems.id, id), eq(s.taskChecklistItems.userId, userId)));
}

export async function addDependency(userId: string, taskId: string, dependsOn: string) {
  if (taskId === dependsOn) throw new TaskError("A task cannot depend on itself.");
  const own = await db()
    .select({ id: s.tasks.id })
    .from(s.tasks)
    .where(and(eq(s.tasks.userId, userId), inArray(s.tasks.id, [taskId, dependsOn])));
  if (own.length !== 2) throw new TaskError("Task not found.");
  // Reject if dependsOn already (transitively) depends on taskId.
  const edges = await db().select().from(s.taskDependencies).where(eq(s.taskDependencies.userId, userId));
  const stack = [dependsOn];
  const seen = new Set<string>();
  while (stack.length) {
    const cur = stack.pop()!;
    if (cur === taskId) throw new TaskError("That dependency would create a loop.");
    if (seen.has(cur)) continue;
    seen.add(cur);
    stack.push(...edges.filter((e) => e.taskId === cur).map((e) => e.dependsOnTaskId));
  }
  await db().insert(s.taskDependencies).values({ userId, taskId, dependsOnTaskId: dependsOn }).onConflictDoNothing();
}

export async function removeDependency(userId: string, taskId: string, dependsOn: string) {
  await db()
    .delete(s.taskDependencies)
    .where(and(eq(s.taskDependencies.userId, userId), eq(s.taskDependencies.taskId, taskId), eq(s.taskDependencies.dependsOnTaskId, dependsOn)));
}

// ---- helpers for planners

export type LoadInput = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  dueAt: Date | null;
  estimatedMinutes: number | null;
  remaining: number;
};

export function toLoadTask(t: s.Task): LoadInput {
  return {
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    scheduledStart: t.scheduledStart,
    scheduledEnd: t.scheduledEnd,
    dueAt: t.dueAt,
    estimatedMinutes: t.estimatedMinutes,
    remaining: remainingMinutes(t),
  };
}

export function sortByPriority<T extends { priority: Priority; scheduledStart: Date | null; dueAt: Date | null }>(rows: T[]): T[] {
  return [...rows].sort(
    (a, b) =>
      PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority] ||
      (a.dueAt?.getTime() ?? Infinity) - (b.dueAt?.getTime() ?? Infinity) ||
      (a.scheduledStart?.getTime() ?? Infinity) - (b.scheduledStart?.getTime() ?? Infinity),
  );
}

export function conflictMessage(err: ConflictError, tz: string) {
  return err.conflicts.map((c) => ({ label: c.label, start: formatInstant(c.start, tz, "EEE d LLL HH:mm"), end: formatInstant(c.end, tz, "HH:mm") }));
}
