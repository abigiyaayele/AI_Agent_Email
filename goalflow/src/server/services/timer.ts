import { and, desc, eq, gte, isNull, lt, ne, or, sql } from "drizzle-orm";
import { elapsedMinutes, finish, pause, resume, TimerError, type TimerState } from "@/lib/domain/timer";
import { overlaps } from "@/lib/domain/scheduling";
import { db, type Executor } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "./audit";

export { TimerError };

const state = (w: s.WorkSession): TimerState => ({ startedAt: w.startedAt, endedAt: w.endedAt, pausedAt: w.pausedAt, pausedMs: w.pausedMs });

/** Recompute a task's cached actual minutes from its finished focus sessions. */
export async function refreshTaskActual(ex: Executor, taskId: string | null) {
  if (!taskId) return;
  const sessions = await ex
    .select()
    .from(s.workSessions)
    .where(and(eq(s.workSessions.taskId, taskId), eq(s.workSessions.kind, "focus")));
  const total = sessions.filter((w) => w.endedAt).reduce((sum, w) => sum + elapsedMinutes(state(w)), 0);
  await ex.update(s.tasks).set({ actualMinutes: total }).where(eq(s.tasks.id, taskId));
}

export function activeSessions(userId: string, ex: Executor = db()) {
  return ex
    .select({ session: s.workSessions, taskTitle: s.tasks.title })
    .from(s.workSessions)
    .leftJoin(s.tasks, eq(s.tasks.id, s.workSessions.taskId))
    .where(and(eq(s.workSessions.userId, userId), isNull(s.workSessions.endedAt)))
    .orderBy(desc(s.workSessions.startedAt));
}

/**
 * Start a timer. Unless the user allows parallel tracking, any other running focus session
 * blocks the start (the user must finish it or explicitly choose to switch).
 * The user's preference row is locked so two tabs can't start timers simultaneously.
 */
export async function startTimer(
  userId: string,
  opts: { taskId: string | null; kind?: "focus" | "break"; pomodoroMinutes?: number | null; switchFromActive?: boolean },
  now = new Date(),
) {
  return db().transaction(async (tx) => {
    const [prefs] = await tx.select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId)).for("update");
    if (opts.taskId) {
      const [t] = await tx.select({ id: s.tasks.id, status: s.tasks.status }).from(s.tasks).where(and(eq(s.tasks.id, opts.taskId), eq(s.tasks.userId, userId)));
      if (!t) throw new TimerError("Task not found.");
      if (t.status === "done") throw new TimerError("That task is already done.");
    }
    const running = await tx
      .select()
      .from(s.workSessions)
      .where(and(eq(s.workSessions.userId, userId), isNull(s.workSessions.endedAt)));
    if (running.length) {
      if (opts.switchFromActive) {
        for (const r of running) {
          await tx.update(s.workSessions).set(finish(state(r), now)).where(eq(s.workSessions.id, r.id));
          await refreshTaskActual(tx, r.taskId);
        }
      } else if (!prefs?.allowParallelTimers || (opts.kind ?? "focus") === "break") {
        throw new TimerError("Another timer is already running. Finish it first, or switch to this task.");
      }
    }
    const [w] = await tx
      .insert(s.workSessions)
      .values({
        userId,
        taskId: opts.taskId,
        kind: opts.kind ?? "focus",
        source: opts.pomodoroMinutes ? "pomodoro" : "timer",
        plannedMinutes: opts.pomodoroMinutes ?? null,
        startedAt: now,
      })
      .returning();
    if (opts.taskId && (opts.kind ?? "focus") === "focus") {
      await tx.update(s.tasks).set({ status: "in_progress" }).where(and(eq(s.tasks.id, opts.taskId), eq(s.tasks.status, "todo")));
    }
    return w!;
  });
}

async function mutate(userId: string, id: string, fn: (w: s.WorkSession) => Partial<s.WorkSession>) {
  return db().transaction(async (tx) => {
    const [w] = await tx.select().from(s.workSessions).where(and(eq(s.workSessions.id, id), eq(s.workSessions.userId, userId))).for("update");
    if (!w) throw new TimerError("Session not found.");
    const [u] = await tx.update(s.workSessions).set(fn(w)).where(eq(s.workSessions.id, id)).returning();
    if (u!.endedAt) await refreshTaskActual(tx, u!.taskId);
    return u!;
  });
}

export const pauseTimer = (userId: string, id: string, now = new Date()) => mutate(userId, id, (w) => pause(state(w), now));
export const resumeTimer = (userId: string, id: string, now = new Date()) => mutate(userId, id, (w) => resume(state(w), now));
export const finishTimer = (userId: string, id: string, note = "", now = new Date()) =>
  mutate(userId, id, (w) => ({ ...finish(state(w), now), note: note || w.note }));

/** Manual entry and corrections. Overlapping focus sessions are rejected unless parallel tracking is on. */
export async function saveManualSession(
  userId: string,
  input: { id?: string; taskId: string | null; startedAt: Date; endedAt: Date; kind: "focus" | "break"; note: string },
) {
  if (input.endedAt <= input.startedAt) throw new TimerError("End must be after start.");
  if (input.endedAt.getTime() - input.startedAt.getTime() > 24 * 3600_000) throw new TimerError("A single session cannot exceed 24 hours.");
  return db().transaction(async (tx) => {
    const [prefs] = await tx.select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId)).for("update");
    if (input.taskId) {
      const [t] = await tx.select({ id: s.tasks.id }).from(s.tasks).where(and(eq(s.tasks.id, input.taskId), eq(s.tasks.userId, userId)));
      if (!t) throw new TimerError("Task not found.");
    }
    if (!prefs?.allowParallelTimers && input.kind === "focus") {
      const near = await tx
        .select()
        .from(s.workSessions)
        .where(
          and(
            eq(s.workSessions.userId, userId),
            eq(s.workSessions.kind, "focus"),
            lt(s.workSessions.startedAt, input.endedAt),
            or(isNull(s.workSessions.endedAt), gte(s.workSessions.endedAt, input.startedAt)),
            input.id ? ne(s.workSessions.id, input.id) : undefined,
          ),
        );
      const clash = near.find((w) => overlaps({ start: w.startedAt, end: w.endedAt ?? new Date() }, { start: input.startedAt, end: input.endedAt }));
      if (clash) throw new TimerError("This overlaps another recorded focus session.");
    }
    let previousTask: string | null = null;
    let row: s.WorkSession;
    if (input.id) {
      const [old] = await tx.select().from(s.workSessions).where(and(eq(s.workSessions.id, input.id), eq(s.workSessions.userId, userId)));
      if (!old) throw new TimerError("Session not found.");
      previousTask = old.taskId;
      [row] = (await tx
        .update(s.workSessions)
        .set({ taskId: input.taskId, startedAt: input.startedAt, endedAt: input.endedAt, pausedAt: null, pausedMs: 0, kind: input.kind, note: input.note })
        .where(eq(s.workSessions.id, input.id))
        .returning()) as [s.WorkSession];
      await audit(tx, userId, "work_session", input.id, "session.corrected", {
        from: { start: old.startedAt, end: old.endedAt },
        to: { start: input.startedAt, end: input.endedAt },
      });
    } else {
      [row] = (await tx
        .insert(s.workSessions)
        .values({ userId, taskId: input.taskId, startedAt: input.startedAt, endedAt: input.endedAt, kind: input.kind, source: "manual", note: input.note })
        .returning()) as [s.WorkSession];
    }
    await refreshTaskActual(tx, input.taskId);
    if (previousTask && previousTask !== input.taskId) await refreshTaskActual(tx, previousTask);
    return row;
  });
}

export async function deleteSession(userId: string, id: string) {
  await db().transaction(async (tx) => {
    const [w] = await tx.delete(s.workSessions).where(and(eq(s.workSessions.id, id), eq(s.workSessions.userId, userId))).returning();
    if (w) {
      await refreshTaskActual(tx, w.taskId);
      await audit(tx, userId, "work_session", id, "session.deleted", { startedAt: w.startedAt, endedAt: w.endedAt });
    }
  });
}

export function sessionsInRange(userId: string, from: Date, to: Date) {
  return db()
    .select({ session: s.workSessions, taskTitle: s.tasks.title, goalId: s.tasks.goalId })
    .from(s.workSessions)
    .leftJoin(s.tasks, eq(s.tasks.id, s.workSessions.taskId))
    .where(
      and(
        eq(s.workSessions.userId, userId),
        lt(s.workSessions.startedAt, to),
        or(isNull(s.workSessions.endedAt), sql`${s.workSessions.endedAt} > ${from}`),
      ),
    )
    .orderBy(desc(s.workSessions.startedAt));
}
