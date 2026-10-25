import type { TaskStatus } from "@/lib/constants";

type EffortTask = {
  status: TaskStatus;
  estimatedMinutes: number | null;
  actualMinutes: number;
  remainingMinutes: number | null;
};

/** Remaining effort for a task: manual override, else estimate minus actual (never negative). */
export function remainingMinutes(t: EffortTask): number {
  if (t.status === "done") return 0;
  if (t.remainingMinutes !== null && t.remainingMinutes !== undefined) return Math.max(0, t.remainingMinutes);
  if (!t.estimatedMinutes) return 0;
  return Math.max(0, t.estimatedMinutes - t.actualMinutes);
}

export const MIN_SAMPLES_FOR_HISTORY = 5;

/**
 * Historical correction factor (median actual / estimate) from completed tasks.
 * Returns null until enough measured samples exist, so callers can label estimates as assumptions.
 */
export function historicalFactor(done: { estimatedMinutes: number | null; actualMinutes: number }[]): number | null {
  const ratios = done
    .filter((t) => (t.estimatedMinutes ?? 0) > 0 && t.actualMinutes > 0)
    .map((t) => t.actualMinutes / t.estimatedMinutes!)
    .sort((a, b) => a - b);
  if (ratios.length < MIN_SAMPLES_FOR_HISTORY) return null;
  const mid = Math.floor(ratios.length / 2);
  const median = ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2;
  return Math.round(Math.min(3, Math.max(0.5, median)) * 100) / 100;
}

export function adjustedEstimate(estimate: number, factor: number | null): { minutes: number; basis: "assumption" | "history" } {
  if (factor === null) return { minutes: estimate, basis: "assumption" };
  return { minutes: Math.round(estimate * factor), basis: "history" };
}

export type AccuracyStats = {
  samples: number;
  /** Share of tasks whose actual time was within ±20% of the estimate. */
  withinTwentyPct: number;
  /** Median actual/estimated ratio. >1 means tasks take longer than planned. */
  medianRatio: number | null;
  totalEstimated: number;
  totalActual: number;
};

export function estimationAccuracy(done: { estimatedMinutes: number | null; actualMinutes: number }[]): AccuracyStats {
  const s = done.filter((t) => (t.estimatedMinutes ?? 0) > 0 && t.actualMinutes > 0);
  const ratios = s.map((t) => t.actualMinutes / t.estimatedMinutes!).sort((a, b) => a - b);
  const within = ratios.filter((r) => r >= 0.8 && r <= 1.2).length;
  const mid = Math.floor(ratios.length / 2);
  return {
    samples: s.length,
    withinTwentyPct: s.length ? Math.round((within / s.length) * 1000) / 10 : 0,
    medianRatio: ratios.length
      ? Math.round((ratios.length % 2 ? ratios[mid]! : (ratios[mid - 1]! + ratios[mid]!) / 2) * 100) / 100
      : null,
    totalEstimated: s.reduce((a, t) => a + t.estimatedMinutes!, 0),
    totalActual: s.reduce((a, t) => a + t.actualMinutes, 0),
  };
}

/**
 * Remaining effort for a goal in hours. Uses the larger of (goal estimate - recorded effort) and
 * the remaining effort of its open tasks, so neither unplanned work nor task estimates are lost.
 */
export function goalRemainingHours(
  goal: { estimatedHours: number | null },
  tasks: EffortTask[],
  actualMinutes: number,
): { hours: number; basis: string } {
  const taskRemaining = tasks.reduce((s, t) => s + remainingMinutes(t), 0) / 60;
  if (goal.estimatedHours && goal.estimatedHours > 0) {
    const fromGoal = Math.max(0, goal.estimatedHours - actualMinutes / 60);
    return fromGoal >= taskRemaining
      ? { hours: round1(fromGoal), basis: "goal estimate minus recorded time" }
      : { hours: round1(taskRemaining), basis: "sum of open task estimates" };
  }
  return { hours: round1(taskRemaining), basis: "sum of open task estimates" };
}

const round1 = (v: number) => Math.round(v * 10) / 10;
