import { PRIORITY_RANK, type Priority, type TaskStatus } from "@/lib/constants";
import { addDays, dayBounds, isoWeekday, localToInstant } from "./periods";

export type Interval = { id: string; label: string; start: Date; end: Date; kind?: "task" | "commitment" };

export function overlaps(a: { start: Date; end: Date }, b: { start: Date; end: Date }): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Items in `others` that overlap the candidate interval (excluding itself). */
export function findConflicts(candidate: Interval, others: Interval[]): Interval[] {
  return others.filter((o) => o.id !== candidate.id && overlaps(candidate, o));
}

/** All overlapping pairs in a list, e.g. for flagging a day's timeline. */
export function overlappingPairs(items: Interval[]): [Interval, Interval][] {
  const sorted = [...items].sort((a, b) => a.start.getTime() - b.start.getTime());
  const pairs: [Interval, Interval][] = [];
  for (let i = 0; i < sorted.length; i++) {
    for (let j = i + 1; j < sorted.length; j++) {
      if (sorted[j]!.start >= sorted[i]!.end) break;
      pairs.push([sorted[i]!, sorted[j]!]);
    }
  }
  return pairs;
}

export type CommitmentLike = { id: string; label: string; days: number[]; startTime: string; endTime: string };

/** Expand weekly recurring commitments into concrete intervals for a given local date. */
export function commitmentsOn(date: string, tz: string, commitments: CommitmentLike[]): Interval[] {
  const wd = isoWeekday(date);
  return commitments
    .filter((c) => c.days.includes(wd))
    .map((c) => {
      const start = localToInstant(date, c.startTime, tz);
      let end = localToInstant(date, c.endTime, tz);
      if (end <= start) end = localToInstant(addDays(date, 1), c.endTime, tz);
      return { id: `commitment:${c.id}:${date}`, label: c.label, start, end, kind: "commitment" as const };
    });
}

export type SlotPrefs = { preferredStart: string; preferredEnd: string; bufferMinutes: number };

/** First free slot of `durationMin` inside the preferred working window of a day. */
export function findFreeSlot(
  date: string,
  tz: string,
  prefs: SlotPrefs,
  busy: Interval[],
  durationMin: number,
  notBefore?: Date,
): { start: Date; end: Date } | null {
  const windowStart = localToInstant(date, prefs.preferredStart, tz);
  const windowEnd = localToInstant(date, prefs.preferredEnd, tz);
  const buf = prefs.bufferMinutes * 60_000;
  const dur = durationMin * 60_000;
  let cursor = new Date(Math.max(windowStart.getTime(), notBefore?.getTime() ?? 0));
  const sorted = [...busy].sort((a, b) => a.start.getTime() - b.start.getTime());
  for (const b of sorted) {
    if (b.end.getTime() + buf <= cursor.getTime()) continue;
    if (b.start.getTime() - buf >= cursor.getTime() + dur) break;
    cursor = new Date(Math.max(cursor.getTime(), b.end.getTime() + buf));
  }
  if (cursor.getTime() + dur > windowEnd.getTime()) return null;
  return { start: cursor, end: new Date(cursor.getTime() + dur) };
}

export type CapacityPrefs = { workingDays: number[]; availableHoursPerDay: number; maxDailyHours: number };

export function dailyCapacityMinutes(date: string, prefs: CapacityPrefs): number {
  if (!prefs.workingDays.includes(isoWeekday(date))) return 0;
  return Math.round(Math.min(prefs.availableHoursPerDay, prefs.maxDailyHours) * 60);
}

export type LoadTask = {
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

/** Planned minutes of a task on a local day: scheduled duration, else remaining estimate. */
export function plannedMinutes(t: LoadTask): number {
  if (t.scheduledStart && t.scheduledEnd) {
    return Math.round((t.scheduledEnd.getTime() - t.scheduledStart.getTime()) / 60_000);
  }
  return t.remaining || t.estimatedMinutes || 0;
}

export type DayLoad = { date: string; capacity: number; planned: number; overload: number; taskIds: string[] };

/** Workload per day for open tasks scheduled (or, if unscheduled, due) on that day. */
export function workloadByDay(dates: string[], tz: string, tasks: LoadTask[], prefs: CapacityPrefs): DayLoad[] {
  return dates.map((date) => {
    const { start, end } = dayBounds(date, tz);
    const dayTasks = tasks.filter((t) => {
      if (t.status === "done" || t.status === "deferred") return false;
      const anchor = t.scheduledStart ?? t.dueAt;
      return anchor !== null && anchor >= start && anchor < end;
    });
    const planned = dayTasks.reduce((s, t) => s + plannedMinutes(t), 0);
    const capacity = dailyCapacityMinutes(date, prefs);
    return { date, capacity, planned, overload: Math.max(0, planned - capacity), taskIds: dayTasks.map((t) => t.id) };
  });
}

export type RescheduleProposal = { taskId: string; title: string; fromDate: string; toDate: string; minutes: number; reason: string };

/**
 * Suggest moving the lowest-priority, non-critical, deadline-safe tasks off overloaded days onto
 * the next days with spare capacity. Never moves critical tasks or tasks past their deadline,
 * and never changes deadlines. The user must approve the proposal before it is applied.
 */
export function proposeRebalance(
  loads: DayLoad[],
  tasks: LoadTask[],
  tz: string,
  prefs: CapacityPrefs,
  horizonDays = 14,
): { proposals: RescheduleProposal[]; unresolved: { date: string; overload: number }[] } {
  const byId = new Map(tasks.map((t) => [t.id, t]));
  const spare = new Map<string, number>();
  const ensureDay = (date: string) => {
    if (!spare.has(date)) {
      const l = loads.find((x) => x.date === date);
      spare.set(date, l ? l.capacity - l.planned : dailyCapacityMinutes(date, prefs));
    }
    return spare.get(date)!;
  };
  loads.forEach((l) => spare.set(l.date, l.capacity - l.planned));
  const proposals: RescheduleProposal[] = [];
  const unresolved: { date: string; overload: number }[] = [];

  for (const day of loads) {
    let excess = day.overload;
    if (excess <= 0) continue;
    const movable = day.taskIds
      .map((id) => byId.get(id)!)
      .filter((t) => t.priority !== "critical")
      .sort((a, b) => PRIORITY_RANK[b.priority] - PRIORITY_RANK[a.priority] || plannedMinutes(b) - plannedMinutes(a));
    for (const t of movable) {
      if (excess <= 0) break;
      const minutes = plannedMinutes(t);
      for (let i = 1; i <= horizonDays; i++) {
        const target = addDays(day.date, i);
        if (t.dueAt && dayBounds(target, tz).start >= t.dueAt) break;
        if (ensureDay(target) >= minutes) {
          spare.set(target, ensureDay(target) - minutes);
          spare.set(day.date, (spare.get(day.date) ?? 0) + minutes);
          excess -= minutes;
          proposals.push({
            taskId: t.id,
            title: t.title,
            fromDate: day.date,
            toDate: target,
            minutes,
            reason: `${day.date} is over capacity by ${day.overload} min; ${t.priority} priority task moved to the next day with room.`,
          });
          break;
        }
      }
    }
    if (excess > 0) unresolved.push({ date: day.date, overload: excess });
  }
  return { proposals, unresolved };
}
