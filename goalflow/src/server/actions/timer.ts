"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { parseLocalDateTime } from "@/lib/domain/tasks";
import { fieldErrors, formToObject, optionalUuid, type ActionResult } from "@/lib/validation/common";
import { requireAuth } from "@/server/auth/session";
import { deleteSession, finishTimer, pauseTimer, resumeTimer, saveManualSession, startTimer, TimerError } from "@/server/services/timer";

const id = z.string().uuid();

async function run(fn: () => Promise<unknown>, message?: string): Promise<ActionResult> {
  try {
    await fn();
  } catch (err) {
    if (err instanceof TimerError) return { ok: false, error: err.message };
    throw err;
  }
  revalidatePath("/", "layout");
  return { ok: true, message };
}

export async function startTimerAction(taskId: string | null, opts: { pomodoro?: boolean; switchFromActive?: boolean; kind?: "focus" | "break" } = {}) {
  const { user, prefs } = await requireAuth();
  const kind = opts.kind ?? "focus";
  const minutes = opts.pomodoro ? (kind === "break" ? prefs.pomodoroBreakMinutes : prefs.pomodoroFocusMinutes) : null;
  return run(() => startTimer(user.id, { taskId: taskId ? id.parse(taskId) : null, kind, pomodoroMinutes: minutes, switchFromActive: opts.switchFromActive }));
}

export async function pauseTimerAction(sessionId: string) {
  const { user } = await requireAuth();
  return run(() => pauseTimer(user.id, id.parse(sessionId)));
}

export async function resumeTimerAction(sessionId: string) {
  const { user } = await requireAuth();
  return run(() => resumeTimer(user.id, id.parse(sessionId)));
}

export async function finishTimerAction(sessionId: string, note: string) {
  const { user } = await requireAuth();
  return run(() => finishTimer(user.id, id.parse(sessionId), z.string().max(2000).parse(note)), "Session saved.");
}

const ManualSchema = z.object({
  id: optionalUuid,
  taskId: optionalUuid,
  start: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter a start"),
  end: z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Enter an end"),
  kind: z.enum(["focus", "break"]).default("focus"),
  note: z.string().max(2000).default(""),
});

export async function saveSessionAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const parsed = ManualSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  return run(
    () =>
      saveManualSession(user.id, {
        id: d.id ?? undefined,
        taskId: d.taskId,
        startedAt: parseLocalDateTime(d.start, prefs.timezone)!,
        endedAt: parseLocalDateTime(d.end, prefs.timezone)!,
        kind: d.kind,
        note: d.note,
      }),
    d.id ? "Session corrected." : "Time entry added.",
  );
}

export async function deleteSessionAction(sessionId: string) {
  const { user } = await requireAuth();
  await deleteSession(user.id, id.parse(sessionId));
  revalidatePath("/", "layout");
}
