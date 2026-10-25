import type { ActiveSession } from "@/components/timer/active-timer";
import type { activeSessions } from "./timer";

export function serializeSessions(rows: Awaited<ReturnType<typeof activeSessions>>): ActiveSession[] {
  return rows.map(({ session: w, taskTitle }) => ({
    id: w.id,
    taskId: w.taskId,
    taskTitle,
    kind: w.kind,
    startedAt: w.startedAt.toISOString(),
    pausedAt: w.pausedAt?.toISOString() ?? null,
    pausedMs: w.pausedMs,
    plannedMinutes: w.plannedMinutes,
  }));
}
