import { and, asc, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import type { z } from "zod";
import type { GoalStatus } from "@/lib/constants";
import { descendantIds, validateParent } from "@/lib/domain/hierarchy";
import { availableWorkingDays, expectedPct, forecastCompletion, paceStatus, requiredHoursPerDay, requiredRate } from "@/lib/domain/pace";
import { todayIn } from "@/lib/domain/periods";
import { computeTreeProgress, type ProgressResult } from "@/lib/domain/progress";
import { goalRemainingHours, historicalFactor } from "@/lib/domain/estimation";
import type { ApplyPlan, GoalInput, MilestoneSchema } from "@/lib/validation/goal";
import { db, type Executor } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { localToInstant } from "@/lib/domain/periods";
import { audit } from "./audit";

export class GoalError extends Error {
  constructor(
    message: string,
    public field?: string,
  ) {
    super(message);
  }
}

export type GoalWithProgress = s.Goal & {
  progress: ProgressResult;
  expected: number;
  pace: ReturnType<typeof paceStatus>;
  actualMinutes: number;
};

/** Load the user's whole goal forest with computed progress (cheap: a person has hundreds of goals at most). */
export async function loadGoalForest(userId: string, today: string, ex: Executor = db()) {
  const [goals, milestones, tasks, minutes] = await Promise.all([
    ex.select().from(s.goals).where(eq(s.goals.userId, userId)).orderBy(asc(s.goals.startDate), asc(s.goals.sortOrder), asc(s.goals.createdAt)),
    ex.select().from(s.goalMilestones).where(eq(s.goalMilestones.userId, userId)).orderBy(asc(s.goalMilestones.sortOrder), asc(s.goalMilestones.dueDate)),
    ex
      .select({
        id: s.tasks.id,
        goalId: s.tasks.goalId,
        status: s.tasks.status,
        estimatedMinutes: s.tasks.estimatedMinutes,
        actualMinutes: s.tasks.actualMinutes,
        remainingMinutes: s.tasks.remainingMinutes,
      })
      .from(s.tasks)
      .where(and(eq(s.tasks.userId, userId), isNotNull(s.tasks.goalId))),
    ex
      .select({ goalId: s.tasks.goalId, minutes: sql<number>`coalesce(sum(${s.tasks.actualMinutes}), 0)::int` })
      .from(s.tasks)
      .where(and(eq(s.tasks.userId, userId), isNotNull(s.tasks.goalId)))
      .groupBy(s.tasks.goalId),
  ]);
  const progress = computeTreeProgress(goals, milestones, tasks);
  const directMinutes = new Map(minutes.map((m) => [m.goalId!, m.minutes]));
  // Effort rolls up: a yearly goal's actual time includes time logged on its descendants' tasks.
  const rolled = new Map<string, number>();
  for (const g of goals) {
    let total = 0;
    for (const id of descendantIds(goals, g.id)) total += directMinutes.get(id) ?? 0;
    rolled.set(g.id, total);
  }
  const withProgress: GoalWithProgress[] = goals.map((g) => {
    const p = progress.get(g.id)!;
    return {
      ...g,
      progress: p,
      expected: expectedPct(g.startDate, g.targetDate, today),
      pace: g.status === "completed" ? "complete" : paceStatus(p.pct, g.startDate, g.targetDate, today),
      actualMinutes: rolled.get(g.id) ?? 0,
    };
  });
  return { goals: withProgress, milestones, tasks };
}

export type GoalNode = GoalWithProgress & { children: GoalNode[] };

export function buildTree(goals: GoalWithProgress[]): GoalNode[] {
  const nodes = new Map<string, GoalNode>(goals.map((g) => [g.id, { ...g, children: [] }]));
  const roots: GoalNode[] = [];
  for (const n of nodes.values()) {
    const parent = n.parentId ? nodes.get(n.parentId) : undefined;
    if (parent) parent.children.push(n);
    else roots.push(n);
  }
  return roots;
}

async function assertParent(ex: Executor, userId: string, input: Pick<GoalInput, "level" | "startDate" | "targetDate" | "parentId">, id?: string) {
  if (!input.parentId) return null;
  const all = await ex.select({ id: s.goals.id, parentId: s.goals.parentId }).from(s.goals).where(eq(s.goals.userId, userId));
  const [parent] = await ex
    .select()
    .from(s.goals)
    .where(and(eq(s.goals.id, input.parentId), eq(s.goals.userId, userId)));
  if (!parent) throw new GoalError("Parent goal not found.", "parentId");
  const issues = validateParent({ id, level: input.level, startDate: input.startDate, targetDate: input.targetDate }, parent, all);
  if (issues.length) throw new GoalError(issues[0]!.message, issues[0]!.code === "dates" ? "targetDate" : "parentId");
  return parent;
}

export async function createGoal(userId: string, input: GoalInput) {
  return db().transaction(async (tx) => {
    await assertParent(tx, userId, input);
    const [g] = await tx
      .insert(s.goals)
      .values({ ...input, userId, completedAt: input.status === "completed" ? new Date() : null })
      .returning();
    await snapshotGoal(tx, userId, g!.id, "auto", "Goal created");
    await audit(tx, userId, "goal", g!.id, "goal.created", { title: g!.title, level: g!.level });
    return g!;
  });
}

export async function updateGoal(userId: string, id: string, input: GoalInput) {
  return db().transaction(async (tx) => {
    const [existing] = await tx.select().from(s.goals).where(and(eq(s.goals.id, id), eq(s.goals.userId, userId)));
    if (!existing) throw new GoalError("Goal not found.");
    await assertParent(tx, userId, input, id);
    // Children must still fit inside a narrowed window and keep a shorter horizon.
    const children = await tx.select().from(s.goals).where(and(eq(s.goals.parentId, id), eq(s.goals.userId, userId)));
    for (const c of children) {
      const issues = validateParent(c, { id, level: input.level, startDate: input.startDate, targetDate: input.targetDate }, []);
      if (issues.length) throw new GoalError(`Child "${c.title}": ${issues[0]!.message}`, "targetDate");
    }
    const completedAt =
      input.status === "completed" ? (existing.completedAt ?? new Date()) : null;
    const [g] = await tx
      .update(s.goals)
      .set({ ...input, completedAt })
      .where(eq(s.goals.id, id))
      .returning();
    const changed = Object.keys(input).filter(
      (k) => JSON.stringify((existing as Record<string, unknown>)[k]) !== JSON.stringify((input as Record<string, unknown>)[k]),
    );
    if (existing.targetDate !== input.targetDate) {
      await audit(tx, userId, "goal", id, "plan.adjusted", { field: "targetDate", from: existing.targetDate, to: input.targetDate });
    }
    await audit(tx, userId, "goal", id, "goal.updated", { changed });
    if (existing.currentValue !== input.currentValue) await snapshotGoal(tx, userId, id, "manual", "Value edited");
    return g!;
  });
}

export async function setGoalStatus(userId: string, id: string, status: GoalStatus) {
  await db().transaction(async (tx) => {
    const [g] = await tx
      .update(s.goals)
      .set({ status, completedAt: status === "completed" ? new Date() : null })
      .where(and(eq(s.goals.id, id), eq(s.goals.userId, userId)))
      .returning();
    if (!g) throw new GoalError("Goal not found.");
    await audit(tx, userId, "goal", id, "goal.status", { status });
  });
}

/**
 * Delete a goal. `reparent` moves children (and tasks) up to the deleted goal's parent so no
 * planned work is lost; `cascade` deletes the whole subtree (tasks are kept, just unlinked).
 */
export async function deleteGoal(userId: string, id: string, mode: "reparent" | "cascade") {
  await db().transaction(async (tx) => {
    const [g] = await tx.select().from(s.goals).where(and(eq(s.goals.id, id), eq(s.goals.userId, userId)));
    if (!g) throw new GoalError("Goal not found.");
    if (mode === "reparent") {
      await tx.update(s.goals).set({ parentId: g.parentId }).where(and(eq(s.goals.parentId, id), eq(s.goals.userId, userId)));
      if (g.parentId) {
        await tx.update(s.tasks).set({ goalId: g.parentId, milestoneId: null }).where(and(eq(s.tasks.goalId, id), eq(s.tasks.userId, userId)));
      }
      await tx.delete(s.goals).where(eq(s.goals.id, id));
    } else {
      const all = await tx.select({ id: s.goals.id, parentId: s.goals.parentId }).from(s.goals).where(eq(s.goals.userId, userId));
      const ids = [...descendantIds(all, id)];
      await tx.delete(s.goals).where(and(inArray(s.goals.id, ids), eq(s.goals.userId, userId)));
    }
    await audit(tx, userId, "goal", id, "goal.deleted", { title: g.title, mode });
  });
}

/** Record a measured value (e.g. books read) and keep a history point for forecasting. */
export async function recordProgress(userId: string, id: string, value: number, note: string) {
  return db().transaction(async (tx) => {
    const [g] = await tx
      .update(s.goals)
      .set({ currentValue: value })
      .where(and(eq(s.goals.id, id), eq(s.goals.userId, userId)))
      .returning();
    if (!g) throw new GoalError("Goal not found.");
    await snapshotGoal(tx, userId, id, "manual", note || null);
    // Cumulative sub-targets (same unit, measured) share the parent's measured value.
    const all = await tx.select().from(s.goals).where(eq(s.goals.userId, userId));
    const below = [...descendantIds(all, id)].filter((d) => d !== id);
    const linked = all.filter((x) => below.includes(x.id) && x.metricType === "numeric" && x.unit === g.unit && x.unit !== "");
    if (linked.length) {
      await tx.update(s.goals).set({ currentValue: value }).where(inArray(s.goals.id, linked.map((x) => x.id)));
    }
    return g;
  });
}

/** Store a progress point for a goal using the current computed progress. */
export async function snapshotGoal(ex: Executor, userId: string, goalId: string, source: "manual" | "auto", note: string | null) {
  const [g] = await ex.select().from(s.goals).where(eq(s.goals.id, goalId));
  if (!g) return;
  const [ms, ts] = await Promise.all([
    ex.select().from(s.goalMilestones).where(eq(s.goalMilestones.goalId, goalId)),
    ex.select().from(s.tasks).where(eq(s.tasks.goalId, goalId)),
  ]);
  let pct = computeTreeProgress([g], ms, ts).get(g.id)?.pct ?? 0;
  if (g.metricType === "children") {
    const forest = await loadGoalForest(userId, todayIn("UTC"), ex);
    pct = forest.goals.find((x) => x.id === goalId)?.progress.pct ?? 0;
  }
  await ex.insert(s.progressSnapshots).values({ userId, goalId, value: g.metricType === "numeric" ? g.currentValue : null, progressPct: pct, source, note });
}

// ---- milestones

export async function addMilestone(userId: string, goalId: string, input: z.infer<typeof MilestoneSchema>) {
  const [g] = await db().select({ id: s.goals.id }).from(s.goals).where(and(eq(s.goals.id, goalId), eq(s.goals.userId, userId)));
  if (!g) throw new GoalError("Goal not found.");
  const [m] = await db().insert(s.goalMilestones).values({ ...input, goalId, userId }).returning();
  return m!;
}

export async function toggleMilestone(userId: string, id: string, done: boolean) {
  await db().transaction(async (tx) => {
    const [m] = await tx
      .update(s.goalMilestones)
      .set({ completedAt: done ? new Date() : null })
      .where(and(eq(s.goalMilestones.id, id), eq(s.goalMilestones.userId, userId)))
      .returning();
    if (!m) throw new GoalError("Milestone not found.");
    await snapshotGoal(tx, userId, m.goalId, "auto", `${done ? "Completed" : "Reopened"} milestone: ${m.title}`);
  });
}

export async function deleteMilestone(userId: string, id: string) {
  await db().delete(s.goalMilestones).where(and(eq(s.goalMilestones.id, id), eq(s.goalMilestones.userId, userId)));
}

// ---- detail

export async function getGoalDetail(userId: string, id: string, prefs: s.Preferences) {
  const today = todayIn(prefs.timezone);
  const forest = await loadGoalForest(userId, today);
  const goal = forest.goals.find((g) => g.id === id);
  if (!goal) return null;
  const byId = new Map(forest.goals.map((g) => [g.id, g]));
  const ancestors: GoalWithProgress[] = [];
  for (let p = goal.parentId ? byId.get(goal.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) {
    ancestors.unshift(p);
    if (ancestors.length > 10) break;
  }
  const children = forest.goals.filter((g) => g.parentId === id);
  const milestones = forest.milestones.filter((m) => m.goalId === id);
  const subtree = descendantIds(forest.goals, id);
  const [tasks, snapshots, doneHistory] = await Promise.all([
    db()
      .select()
      .from(s.tasks)
      .where(and(eq(s.tasks.userId, userId), inArray(s.tasks.goalId, [...subtree])))
      .orderBy(sql`${s.tasks.scheduledStart} asc nulls last`, asc(s.tasks.createdAt)),
    db()
      .select()
      .from(s.progressSnapshots)
      .where(and(eq(s.progressSnapshots.goalId, id), eq(s.progressSnapshots.userId, userId)))
      .orderBy(asc(s.progressSnapshots.capturedAt)),
    db()
      .select({ estimatedMinutes: s.tasks.estimatedMinutes, actualMinutes: s.tasks.actualMinutes })
      .from(s.tasks)
      .where(and(eq(s.tasks.userId, userId), eq(s.tasks.status, "done")))
      .orderBy(desc(s.tasks.completedAt))
      .limit(200),
  ]);

  const remaining = goalRemainingHours(goal, tasks, goal.actualMinutes);
  const fromDay = today > goal.startDate ? today : goal.startDate;
  const workDays = availableWorkingDays(fromDay, goal.targetDate, prefs.workingDays);
  const perDay = requiredHoursPerDay(remaining.hours, workDays);
  const factor = historicalFactor(doneHistory);
  let quantity: { remaining: number; perMonth: number | null; perWeek: number | null } | null = null;
  if (goal.metricType === "numeric" && goal.targetValue !== null) {
    const rem = goal.direction === "increase" ? goal.targetValue - goal.currentValue : goal.currentValue - goal.targetValue;
    quantity = {
      remaining: Math.max(0, Math.round(rem * 100) / 100),
      perMonth: requiredRate(Math.max(0, rem), fromDay, goal.targetDate, "month"),
      perWeek: requiredRate(Math.max(0, rem), fromDay, goal.targetDate, "week"),
    };
  }
  const forecast =
    goal.metricType === "numeric" && goal.targetValue !== null
      ? forecastCompletion(
          snapshots.filter((x) => x.value !== null).map((x) => ({ at: x.capturedAt, value: x.value! })),
          goal.targetValue,
          goal.direction,
        )
      : null;
  return {
    goal,
    ancestors,
    children,
    milestones,
    tasks,
    snapshots,
    allGoals: forest.goals,
    effort: {
      remainingHours: remaining.hours,
      remainingBasis: remaining.basis,
      workDays,
      requiredPerDay: perDay,
      capacityPerDay: Math.min(prefs.availableHoursPerDay, prefs.maxDailyHours),
      historicalFactor: factor,
    },
    quantity,
    forecast,
  };
}

// ---- apply an approved breakdown plan

export async function applyPlan(userId: string, plan: ApplyPlan, tz: string) {
  const included = plan.goals.filter((g) => g.include);
  const keys = new Set(included.map((g) => g.key));
  const root = included.find((g) => g.parentKey === null);
  if (!root) throw new GoalError("The plan needs its top-level goal.");
  // Validate structure before writing anything.
  for (const g of included) {
    if (g.parentKey && !keys.has(g.parentKey)) {
      throw new GoalError(`"${g.title}" is included but its parent is not. Include the parent or exclude this item.`);
    }
    if (g.targetDate < g.startDate) throw new GoalError(`"${g.title}" ends before it starts.`);
  }
  return db().transaction(async (tx) => {
    const idByKey = new Map<string, string>();
    const levelOrder = ["year", "half", "quarter", "month", "week"];
    const sorted = [...included].sort((a, b) => levelOrder.indexOf(a.level) - levelOrder.indexOf(b.level));
    for (const g of sorted) {
      const parentId = g.parentKey ? idByKey.get(g.parentKey)! : null;
      if (parentId) {
        const parent = sorted.find((p) => p.key === g.parentKey)!;
        const issues = validateParent({ level: g.level, startDate: g.startDate, targetDate: g.targetDate }, { id: parentId, ...parent }, []);
        if (issues.length) throw new GoalError(`"${g.title}": ${issues[0]!.message}`);
      }
      const [row] = await tx
        .insert(s.goals)
        .values({
          userId,
          parentId,
          level: g.level,
          title: g.title,
          description: g.key === root.key ? plan.description : "",
          category: plan.category,
          startDate: g.startDate,
          targetDate: g.targetDate,
          // Every level tracks the same measured value against its own cumulative target, so a
          // recorded value on the yearly goal flows down (see recordProgress).
          metricType: "numeric",
          unit: g.unit,
          direction: g.direction,
          startValue: g.startValue,
          targetValue: g.targetValue,
          currentValue: g.startValue,
          estimatedHours: g.estimatedHours,
          priority: g.key === root.key ? "high" : "medium",
          sortOrder: sorted.indexOf(g),
        })
        .returning({ id: s.goals.id });
      idByKey.set(g.key, row!.id);
    }
    const rootId = idByKey.get(root.key)!;
    for (const [i, m] of plan.milestones.entries()) {
      await tx.insert(s.goalMilestones).values({ userId, goalId: rootId, title: m.title, weight: m.weight, sortOrder: i });
    }
    let created = 0;
    for (const t of plan.tasks.filter((x) => x.include)) {
      const goalId = idByKey.get(t.goalKey) ?? rootId;
      await tx.insert(s.tasks).values({
        userId,
        goalId,
        title: t.title,
        priority: t.priority,
        estimatedMinutes: t.estimatedMinutes,
        dueAt: localToInstant(t.date, "23:59", tz),
      });
      created++;
    }
    await audit(tx, userId, "goal", rootId, "plan.applied", { goals: included.length, tasks: created });
    return { rootId, goals: included.length, tasks: created };
  });
}
