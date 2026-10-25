import { DateTime } from "luxon";
import type { TaskStatus } from "@/lib/constants";
import { dayBounds, instantToLocal, localToInstant } from "./periods";

/** Allowed status transitions. Done tasks must be reopened (To Do) before being blocked or deferred. */
export const TRANSITIONS: Record<TaskStatus, TaskStatus[]> = {
  todo: ["in_progress", "done", "blocked", "deferred"],
  in_progress: ["todo", "done", "blocked", "deferred"],
  blocked: ["todo", "in_progress", "deferred", "done"],
  deferred: ["todo", "in_progress", "blocked"],
  done: ["todo", "in_progress"],
};

export function canTransition(from: TaskStatus, to: TaskStatus): boolean {
  return from === to || TRANSITIONS[from].includes(to);
}

export class TransitionError extends Error {
  constructor(from: TaskStatus, to: TaskStatus) {
    super(`A task cannot move from ${from} to ${to}.`);
    this.name = "TransitionError";
  }
}

/** Fields to write when a task changes status. */
export function statusPatch(
  from: TaskStatus,
  to: TaskStatus,
  now: Date = new Date(),
): { status: TaskStatus; completedAt: Date | null } {
  if (!canTransition(from, to)) throw new TransitionError(from, to);
  return { status: to, completedAt: to === "done" ? now : null };
}

type Schedulable = {
  scheduledStart: Date | null;
  scheduledEnd: Date | null;
  dueAt: Date | null;
  carryOverCount: number;
  status: TaskStatus;
};

/**
 * Move unfinished work to another day while keeping its time of day and duration.
 * Deadlines are never changed silently: a due date is moved only when it was the task's sole
 * anchor (unscheduled task due on the source day) and the caller opted in via `moveDue`.
 */
export function carryOverPatch(
  t: Schedulable,
  targetDate: string,
  tz: string,
  opts: { moveDue?: boolean } = {},
): { scheduledStart: Date | null; scheduledEnd: Date | null; dueAt: Date | null; carryOverCount: number; status: TaskStatus } {
  let scheduledStart = t.scheduledStart;
  let scheduledEnd = t.scheduledEnd;
  let dueAt = t.dueAt;
  if (t.scheduledStart) {
    const local = instantToLocal(t.scheduledStart, tz);
    scheduledStart = localToInstant(targetDate, local.time, tz);
    if (t.scheduledEnd) {
      scheduledEnd = new Date(scheduledStart.getTime() + (t.scheduledEnd.getTime() - t.scheduledStart.getTime()));
    }
  } else if (opts.moveDue && t.dueAt) {
    const local = instantToLocal(t.dueAt, tz);
    dueAt = localToInstant(targetDate, local.time, tz);
  } else if (!t.dueAt) {
    // Unscheduled & undated: give it a plan date by scheduling it as a due-today item.
    dueAt = new Date(dayBounds(targetDate, tz).end.getTime() - 60_000);
  }
  return {
    scheduledStart,
    scheduledEnd,
    dueAt,
    carryOverCount: t.carryOverCount + 1,
    status: t.status === "in_progress" || t.status === "blocked" ? t.status : "todo",
  };
}

export function isOverdue(t: { status: TaskStatus; dueAt: Date | null }, now: Date = new Date()): boolean {
  return t.status !== "done" && t.status !== "deferred" && t.dueAt !== null && t.dueAt < now;
}

export function minutesBetween(a: Date, b: Date) {
  return Math.round((b.getTime() - a.getTime()) / 60_000);
}

/** Parse `<input type="datetime-local">` value (local wall clock) into an instant in the user's zone. */
export function parseLocalDateTime(value: string | null | undefined, tz: string): Date | null {
  if (!value) return null;
  const dt = DateTime.fromISO(value, { zone: tz });
  return dt.isValid ? dt.toJSDate() : null;
}

export function toLocalInputValue(instant: Date | null | undefined, tz: string): string {
  if (!instant) return "";
  return DateTime.fromJSDate(instant, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm");
}
