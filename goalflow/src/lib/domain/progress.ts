import type { Direction, MetricType, TaskStatus } from "@/lib/constants";

export type GoalLike = {
  id: string;
  parentId: string | null;
  metricType: MetricType;
  direction: Direction;
  startValue: number;
  targetValue: number | null;
  currentValue: number;
  weight: number;
  status: string;
};
export type MilestoneLike = { goalId: string; weight: number; completedAt: Date | string | null };
export type TaskLike = {
  goalId: string | null;
  status: TaskStatus;
  estimatedMinutes: number | null;
  actualMinutes: number;
};

export type ProgressResult = {
  /** 0..100, rounded to one decimal. */
  pct: number;
  method: MetricType;
  /** Plain-language explanation of how the number was produced. */
  explanation: string;
  /** True when part of the number rests on an assumption (e.g. default task size). */
  assumption: boolean;
};

/** Default effort assumed for tasks without an estimate when weighting task progress. */
export const DEFAULT_TASK_MINUTES = 30;

const clampPct = (v: number) => Math.round(Math.min(100, Math.max(0, v)) * 10) / 10;

/** Progress of a measurable goal. Supports goals where a lower value is better. */
export function numericProgress(g: Pick<GoalLike, "direction" | "startValue" | "targetValue" | "currentValue">): ProgressResult {
  if (g.targetValue === null || g.targetValue === undefined) {
    return { pct: 0, method: "numeric", explanation: "No target value set yet.", assumption: false };
  }
  const span = g.direction === "increase" ? g.targetValue - g.startValue : g.startValue - g.targetValue;
  const moved = g.direction === "increase" ? g.currentValue - g.startValue : g.startValue - g.currentValue;
  if (span <= 0) {
    const reached = g.direction === "increase" ? g.currentValue >= g.targetValue : g.currentValue <= g.targetValue;
    return {
      pct: reached ? 100 : 0,
      method: "numeric",
      explanation: "Start value already meets or passes the target.",
      assumption: false,
    };
  }
  const pct = clampPct((moved / span) * 100);
  const verb = g.direction === "increase" ? "gained" : "reduced";
  return {
    pct,
    method: "numeric",
    explanation: `${verb} ${round(moved)} of ${round(span)} (from ${round(g.startValue)} towards ${round(g.targetValue)}).`,
    assumption: false,
  };
}

export function milestoneProgress(milestones: MilestoneLike[]): ProgressResult {
  const total = milestones.reduce((s, m) => s + Math.max(0, m.weight), 0);
  if (milestones.length === 0 || total === 0) {
    return { pct: 0, method: "milestones", explanation: "No weighted milestones defined yet.", assumption: false };
  }
  const done = milestones.filter((m) => m.completedAt).reduce((s, m) => s + Math.max(0, m.weight), 0);
  return {
    pct: clampPct((done / total) * 100),
    method: "milestones",
    explanation: `${milestones.filter((m) => m.completedAt).length} of ${milestones.length} milestones complete (weight ${round(done)} of ${round(total)}).`,
    assumption: false,
  };
}

export function taskProgress(tasks: TaskLike[]): ProgressResult {
  const relevant = tasks.filter((t) => t.status !== "deferred");
  if (relevant.length === 0) {
    return { pct: 0, method: "tasks", explanation: "No linked tasks yet.", assumption: false };
  }
  let assumption = false;
  const size = (t: TaskLike) => {
    if (t.estimatedMinutes && t.estimatedMinutes > 0) return t.estimatedMinutes;
    assumption = true;
    return DEFAULT_TASK_MINUTES;
  };
  const total = relevant.reduce((s, t) => s + size(t), 0);
  const done = relevant.filter((t) => t.status === "done").reduce((s, t) => s + size(t), 0);
  return {
    pct: clampPct((done / total) * 100),
    method: "tasks",
    explanation: `${relevant.filter((t) => t.status === "done").length} of ${relevant.length} tasks done, weighted by estimated effort${assumption ? ` (unestimated tasks counted as ${DEFAULT_TASK_MINUTES} min)` : ""}.`,
    assumption,
  };
}

export function weightedChildren(children: { weight: number; pct: number }[]): { pct: number; total: number } {
  const total = children.reduce((s, c) => s + Math.max(0, c.weight), 0);
  if (total === 0) return { pct: 0, total: 0 };
  return { pct: clampPct(children.reduce((s, c) => s + Math.max(0, c.weight) * c.pct, 0) / total), total };
}

/**
 * Compute progress for every goal in a forest. Roll-up goals use their children's progress
 * weighted by each child's `weight`; abandoned children are excluded.
 */
export function computeTreeProgress(
  goals: GoalLike[],
  milestones: MilestoneLike[],
  tasks: TaskLike[],
): Map<string, ProgressResult> {
  const byParent = new Map<string, GoalLike[]>();
  for (const g of goals) {
    if (!g.parentId) continue;
    const list = byParent.get(g.parentId) ?? [];
    list.push(g);
    byParent.set(g.parentId, list);
  }
  const msByGoal = groupBy(milestones, (m) => m.goalId);
  const tasksByGoal = groupBy(tasks, (t) => t.goalId ?? "");
  const out = new Map<string, ProgressResult>();
  const visiting = new Set<string>();

  const visit = (g: GoalLike): ProgressResult => {
    const cached = out.get(g.id);
    if (cached) return cached;
    if (visiting.has(g.id)) {
      return { pct: 0, method: g.metricType, explanation: "Cycle detected in hierarchy.", assumption: false };
    }
    visiting.add(g.id);
    let r: ProgressResult;
    switch (g.metricType) {
      case "numeric":
        r = numericProgress(g);
        break;
      case "milestones":
        r = milestoneProgress(msByGoal.get(g.id) ?? []);
        break;
      case "tasks":
        r = taskProgress(tasksByGoal.get(g.id) ?? []);
        break;
      case "children": {
        const kids = (byParent.get(g.id) ?? []).filter((c) => c.status !== "abandoned");
        const rolled = weightedChildren(kids.map((c) => ({ weight: c.weight, pct: visit(c).pct })));
        r = {
          pct: rolled.pct,
          method: "children",
          explanation:
            kids.length === 0
              ? "No child goals yet."
              : `Weighted average of ${kids.length} child goal${kids.length === 1 ? "" : "s"}.`,
          assumption: kids.some((c) => out.get(c.id)?.assumption),
        };
        break;
      }
    }
    visiting.delete(g.id);
    out.set(g.id, r);
    return r;
  };
  for (const g of goals) visit(g);
  return out;
}

function groupBy<T>(items: T[], key: (t: T) => string): Map<string, T[]> {
  const m = new Map<string, T[]>();
  for (const it of items) {
    const k = key(it);
    const list = m.get(k) ?? [];
    list.push(it);
    m.set(k, list);
  }
  return m;
}

function round(v: number) {
  return Math.round(v * 100) / 100;
}
