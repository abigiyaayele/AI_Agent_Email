import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { localToInstant } from "@/lib/domain/periods";
import { TaskSchema } from "@/lib/validation/task";
import { closeDb, db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getPreferences } from "@/server/services/account";
import {
  addDependency,
  carryOverTasks,
  ConflictError,
  createTask,
  getTask,
  listTasks,
  materializeRecurring,
  rescheduleTask,
  setTaskStatus,
  TaskError,
} from "@/server/services/tasks";
import { finishTimer, pauseTimer, resumeTimer, saveManualSession, startTimer, TimerError } from "@/server/services/timer";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

const input = (over: Record<string, unknown>) => TaskSchema.parse({ title: "Task", ...over });

async function setup(tz = "UTC") {
  const u = await makeUser(tz);
  const prefs = (await getPreferences(u.id))!;
  return { u, prefs };
}

describe("task scheduling", () => {
  it("refuses overlapping times unless overlap is explicitly allowed", async () => {
    const { u, prefs } = await setup();
    await createTask(u.id, prefs, input({ title: "A", scheduledStart: "2026-11-02T10:00", durationMinutes: "60" }));
    await expect(createTask(u.id, prefs, input({ title: "B", scheduledStart: "2026-11-02T10:30", durationMinutes: "30" }))).rejects.toBeInstanceOf(ConflictError);
    const ok = await createTask(u.id, prefs, input({ title: "B", scheduledStart: "2026-11-02T10:30", durationMinutes: "30", allowOverlap: "on" }));
    expect(ok.allowOverlap).toBe(true);
    // Back-to-back is not an overlap.
    await createTask(u.id, prefs, input({ title: "C", scheduledStart: "2026-11-02T11:00", durationMinutes: "30" }));
  });

  it("checks fixed commitments too", async () => {
    const { u, prefs } = await setup();
    await db().insert(s.schedules).values({ userId: u.id, label: "Work", days: [1, 2, 3, 4, 5], startTime: "09:00", endTime: "17:00" });
    // 2026-11-02 is a Monday
    await expect(createTask(u.id, prefs, input({ scheduledStart: "2026-11-02T12:00", durationMinutes: "30" }))).rejects.toBeInstanceOf(ConflictError);
    await createTask(u.id, prefs, input({ scheduledStart: "2026-11-01T12:00", durationMinutes: "30" })); // Sunday
  });

  it("reschedules keeping duration and refuses overlaps", async () => {
    const { u, prefs } = await setup();
    await createTask(u.id, prefs, input({ title: "A", scheduledStart: "2026-11-02T10:00", durationMinutes: "60" }));
    const b = await createTask(u.id, prefs, input({ title: "B", scheduledStart: "2026-11-02T14:00", durationMinutes: "45" }));
    await expect(rescheduleTask(u.id, prefs, b.id, new Date("2026-11-02T10:15:00Z"))).rejects.toBeInstanceOf(ConflictError);
    const moved = await rescheduleTask(u.id, prefs, b.id, new Date("2026-11-02T12:00:00Z"));
    expect(moved.scheduledEnd!.toISOString()).toBe("2026-11-02T12:45:00.000Z");
    const forced = await rescheduleTask(u.id, prefs, b.id, new Date("2026-11-02T10:15:00Z"), true);
    expect(forced.allowOverlap).toBe(true);
    const d = await getTask(u.id, b.id);
    expect(d!.history.filter((h) => h.action === "task.rescheduled")).toHaveLength(3 - 1);
  });

  it("interprets local times in the user's timezone", async () => {
    const { u, prefs } = await setup("America/New_York");
    const t = await createTask(u.id, prefs, input({ scheduledStart: "2026-11-02T09:00", durationMinutes: "30" }));
    expect(t.scheduledStart!.toISOString()).toBe(localToInstant("2026-11-02", "09:00", "America/New_York").toISOString());
    expect(t.scheduledStart!.toISOString()).toBe("2026-11-02T14:00:00.000Z");
  });
});

describe("task status and carry-over", () => {
  it("enforces transitions, stamps completion and records history", async () => {
    const { u, prefs } = await setup();
    const t = await createTask(u.id, prefs, input({}));
    const done = await setTaskStatus(u.id, prefs, t.id, "done");
    expect(done.completedAt).toBeInstanceOf(Date);
    const reopened = await setTaskStatus(u.id, prefs, t.id, "todo");
    expect(reopened.completedAt).toBeNull();
    const d = await getTask(u.id, t.id);
    expect(d!.history.map((h) => h.action)).toContain("task.status");
  });

  it("blocks completing a task whose dependency is unfinished", async () => {
    const { u, prefs } = await setup();
    const a = await createTask(u.id, prefs, input({ title: "A" }));
    const b = await createTask(u.id, prefs, input({ title: "B" }));
    await addDependency(u.id, b.id, a.id);
    await expect(addDependency(u.id, a.id, b.id)).rejects.toBeInstanceOf(TaskError);
    await expect(setTaskStatus(u.id, prefs, b.id, "done")).rejects.toBeInstanceOf(TaskError);
    await setTaskStatus(u.id, prefs, a.id, "done");
    await setTaskStatus(u.id, prefs, b.id, "done");
  });

  it("carries unfinished work to another day without losing history", async () => {
    const { u, prefs } = await setup();
    const t = await createTask(u.id, prefs, input({ scheduledStart: "2026-11-02T10:00", durationMinutes: "60", dueAt: "2026-11-02T18:00" }));
    const n = await carryOverTasks(u.id, prefs, [t.id], "2026-11-03");
    expect(n).toBe(1);
    const d = await getTask(u.id, t.id);
    expect(d!.task.carryOverCount).toBe(1);
    expect(d!.task.scheduledStart!.toISOString().slice(0, 10)).toBe("2026-11-03");
    // The deadline is never moved silently.
    expect(d!.task.dueAt?.toISOString()).toBe("2026-11-02T18:00:00.000Z");
    expect(d!.history.some((h) => h.action === "task.carried_over")).toBe(true);
  });
});

describe("recurring tasks", () => {
  it("materializes occurrences once, even when called repeatedly", async () => {
    const { u, prefs } = await setup();
    const t = await createTask(u.id, prefs, input({ title: "Run", scheduledStart: "2026-11-02T07:00", durationMinutes: "30", recurrenceFreq: "daily", allowOverlap: "on" }));
    const from = new Date("2026-11-02T00:00:00Z");
    const to = new Date("2026-11-09T00:00:00Z");
    const first = await materializeRecurring(u.id, from, to);
    const second = await materializeRecurring(u.id, from, to);
    expect(first).toBe(6);
    expect(second).toBe(0);
    const rows = await db().select().from(s.tasks).where(and(eq(s.tasks.userId, u.id), eq(s.tasks.recurrenceParentId, t.id)));
    expect(rows).toHaveLength(6);
  });
});

describe("isolation", () => {
  it("never returns or mutates another user's tasks", async () => {
    const a = await setup();
    const b = await setup();
    const t = await createTask(a.u.id, a.prefs, input({ title: "Private" }));
    expect(await getTask(b.u.id, t.id)).toBeNull();
    expect(await listTasks(b.u.id, "UTC")).toHaveLength(0);
    await expect(setTaskStatus(b.u.id, b.prefs, t.id, "done")).rejects.toBeInstanceOf(TaskError);
    await expect(startTimer(b.u.id, { taskId: t.id })).rejects.toBeInstanceOf(TimerError);
    await expect(createTask(b.u.id, b.prefs, input({ parentTaskId: t.id }))).rejects.toBeInstanceOf(TaskError);
  });
});

describe("focus timer", () => {
  it("tracks pauses and rolls actual time up to the task", async () => {
    const { u, prefs } = await setup();
    const t = await createTask(u.id, prefs, input({ estimatedMinutes: "60" }));
    const t0 = new Date("2026-11-02T10:00:00Z");
    const w = await startTimer(u.id, { taskId: t.id }, t0);
    await pauseTimer(u.id, w.id, new Date("2026-11-02T10:20:00Z"));
    await resumeTimer(u.id, w.id, new Date("2026-11-02T10:30:00Z"));
    await finishTimer(u.id, w.id, "done", new Date("2026-11-02T10:45:00Z"));
    const d = await getTask(u.id, t.id);
    expect(d!.task.actualMinutes).toBe(35);
    // starting a task timer moves it to In Progress
    expect(d!.task.status).toBe("in_progress");
  });

  it("prevents accidental parallel timers but allows an explicit switch", async () => {
    const { u, prefs } = await setup();
    const a = await createTask(u.id, prefs, input({ title: "A" }));
    const b = await createTask(u.id, prefs, input({ title: "B" }));
    await startTimer(u.id, { taskId: a.id }, new Date("2026-11-02T10:00:00Z"));
    await expect(startTimer(u.id, { taskId: b.id }, new Date("2026-11-02T10:10:00Z"))).rejects.toBeInstanceOf(TimerError);
    await startTimer(u.id, { taskId: b.id, switchFromActive: true }, new Date("2026-11-02T10:10:00Z"));
    const running = await db().select().from(s.workSessions).where(eq(s.workSessions.userId, u.id));
    expect(running.filter((r) => r.endedAt === null)).toHaveLength(1);
    expect((await getTask(u.id, a.id))!.task.actualMinutes).toBe(10);
  });

  it("refuses overlapping manual focus entries and audits corrections", async () => {
    const { u, prefs } = await setup();
    const t = await createTask(u.id, prefs, input({}));
    const w = await saveManualSession(u.id, { taskId: t.id, startedAt: new Date("2026-11-02T08:00:00Z"), endedAt: new Date("2026-11-02T09:00:00Z"), kind: "focus", note: "" });
    await expect(
      saveManualSession(u.id, { taskId: t.id, startedAt: new Date("2026-11-02T08:30:00Z"), endedAt: new Date("2026-11-02T09:30:00Z"), kind: "focus", note: "" }),
    ).rejects.toBeInstanceOf(TimerError);
    await expect(
      saveManualSession(u.id, { taskId: t.id, startedAt: new Date("2026-11-02T09:00:00Z"), endedAt: new Date("2026-11-02T08:00:00Z"), kind: "focus", note: "" }),
    ).rejects.toBeInstanceOf(TimerError);
    await saveManualSession(u.id, { id: w.id, taskId: t.id, startedAt: new Date("2026-11-02T08:00:00Z"), endedAt: new Date("2026-11-02T08:40:00Z"), kind: "focus", note: "fixed" });
    expect((await getTask(u.id, t.id))!.task.actualMinutes).toBe(40);
    const audits = await db().select().from(s.auditEvents).where(eq(s.auditEvents.userId, u.id));
    expect(audits.some((a) => a.action === "session.corrected")).toBe(true);
  });
});
