"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { TASK_STATUSES } from "@/lib/constants";
import { proposeRebalance, workloadByDay } from "@/lib/domain/scheduling";
import { eachDate, localToInstant } from "@/lib/domain/periods";
import { fieldErrors, formToObject, type ActionResult } from "@/lib/validation/common";
import { QuickTaskSchema, TaskSchema } from "@/lib/validation/task";
import { requireAuth } from "@/server/auth/session";
import {
  addChecklistItem,
  addDependency,
  carryOverTasks,
  ConflictError,
  conflictMessage,
  createTask,
  deleteChecklistItem,
  deleteTask,
  quickAddTask,
  removeDependency,
  rescheduleTask,
  setTaskStatus,
  TaskError,
  tasksInRange,
  toggleChecklistItem,
  toLoadTask,
  updateTask,
} from "@/server/services/tasks";
import { dayBounds } from "@/lib/domain/periods";

const id = z.string().uuid();

function revalidateTasks() {
  revalidatePath("/", "layout");
}

function handle(err: unknown, tz: string): ActionResult {
  if (err instanceof ConflictError) {
    return { ok: false, error: "This time overlaps other scheduled items. Pick another time or tick “Allow overlap”.", conflicts: conflictMessage(err, tz) };
  }
  if (err instanceof TaskError) return { ok: false, error: err.message, fieldErrors: err.field ? { [err.field]: err.message } : undefined };
  throw err;
}

function parseTask(fd: FormData) {
  const raw = formToObject(fd);
  return TaskSchema.safeParse({ ...raw, recurrenceDays: raw.recurrenceDays ?? [] });
}

export async function createTaskAction(_prev: unknown, fd: FormData): Promise<ActionResult<{ id: string }>> {
  const { user, prefs } = await requireAuth();
  const parsed = parseTask(fd);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  try {
    const t = await createTask(user.id, prefs, parsed.data);
    revalidateTasks();
    return { ok: true, message: "Task created.", data: { id: t.id } };
  } catch (err) {
    return handle(err, prefs.timezone) as ActionResult<{ id: string }>;
  }
}

export async function updateTaskAction(taskId: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const parsed = parseTask(fd);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await updateTask(user.id, prefs, id.parse(taskId), parsed.data);
  } catch (err) {
    return handle(err, prefs.timezone);
  }
  revalidateTasks();
  return { ok: true, message: "Task saved." };
}

export async function quickAddAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const parsed = QuickTaskSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]!.message, fieldErrors: fieldErrors(parsed.error) };
  try {
    await quickAddTask(user.id, prefs, parsed.data);
  } catch (err) {
    return handle(err, prefs.timezone);
  }
  revalidateTasks();
  return { ok: true, message: "Added." };
}

export async function setTaskStatusAction(taskId: string, status: string): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  try {
    await setTaskStatus(user.id, prefs, id.parse(taskId), z.enum(TASK_STATUSES).parse(status));
  } catch (err) {
    return handle(err, prefs.timezone);
  }
  revalidateTasks();
  return { ok: true };
}

/** `start` is a local "yyyy-MM-ddTHH:mm" in the user's zone, or null to unschedule. */
export async function rescheduleAction(taskId: string, start: string | null, allowOverlap = false): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const when = start ? z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/).parse(start) : null;
  try {
    await rescheduleTask(user.id, prefs, id.parse(taskId), when ? localToInstant(when.slice(0, 10), when.slice(11), prefs.timezone) : null, allowOverlap);
  } catch (err) {
    return handle(err, prefs.timezone);
  }
  revalidateTasks();
  return { ok: true };
}

export async function carryOverAction(taskIds: string[], targetDate: string): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const ids = z.array(id).min(1).max(200).parse(taskIds);
  const date = z.string().regex(/^\d{4}-\d{2}-\d{2}$/).parse(targetDate);
  const n = await carryOverTasks(user.id, prefs, ids, date);
  revalidateTasks();
  return { ok: true, message: `Moved ${n} task${n === 1 ? "" : "s"} to ${date}.` };
}

export async function deleteTaskAction(taskId: string) {
  const { user } = await requireAuth();
  await deleteTask(user.id, id.parse(taskId));
  revalidateTasks();
}

export async function addChecklistAction(taskId: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const title = z.string().trim().min(1, "Type an item").max(300).safeParse(fd.get("title"));
  if (!title.success) return { ok: false, error: title.error.issues[0]!.message };
  await addChecklistItem(user.id, id.parse(taskId), title.data);
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function toggleChecklistAction(itemId: string, done: boolean) {
  const { user } = await requireAuth();
  await toggleChecklistItem(user.id, id.parse(itemId), done);
  revalidatePath("/tasks", "layout");
}

export async function deleteChecklistAction(itemId: string) {
  const { user } = await requireAuth();
  await deleteChecklistItem(user.id, id.parse(itemId));
  revalidatePath("/tasks", "layout");
}

export async function addDependencyAction(taskId: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  try {
    await addDependency(user.id, id.parse(taskId), id.parse(fd.get("dependsOn")));
  } catch (err) {
    return handle(err, prefs.timezone);
  }
  revalidatePath(`/tasks/${taskId}`);
  return { ok: true };
}

export async function removeDependencyAction(taskId: string, dependsOn: string) {
  const { user } = await requireAuth();
  await removeDependency(user.id, id.parse(taskId), id.parse(dependsOn));
  revalidatePath(`/tasks/${taskId}`);
}

/** Apply an approved rebalance: each move keeps the task's time of day. */
export async function applyRebalanceAction(moves: { taskId: string; toDate: string }[]): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const parsed = z.array(z.object({ taskId: id, toDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/) })).max(100).parse(moves);
  for (const m of parsed) await carryOverTasks(user.id, prefs, [m.taskId], m.toDate);
  revalidateTasks();
  return { ok: true, message: `Moved ${parsed.length} task(s).` };
}

/** Workload check for a date range, with a proposed rebalance the user can approve. */
export async function workloadAction(fromDate: string, toDate: string) {
  const { user, prefs } = await requireAuth();
  const dates = eachDate(fromDate, toDate).slice(0, 31);
  const rows = await tasksInRange(user.id, dayBounds(dates[0]!, prefs.timezone).start, dayBounds(dates.at(-1)!, prefs.timezone).end);
  const tasks = rows.map((r) => toLoadTask(r.task));
  const loads = workloadByDay(dates, prefs.timezone, tasks, prefs);
  return { loads, ...proposeRebalance(loads, tasks, prefs.timezone, prefs) };
}
