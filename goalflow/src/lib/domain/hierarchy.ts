import { GOAL_LEVELS, type GoalLevel } from "@/lib/constants";

export const LEVEL_RANK: Record<GoalLevel, number> = { year: 0, half: 1, quarter: 2, month: 3, week: 4 };

/** A child must sit at a strictly lower horizon than its parent (levels may be skipped). */
export function isValidChildLevel(parent: GoalLevel, child: GoalLevel): boolean {
  return LEVEL_RANK[child] > LEVEL_RANK[parent];
}

export function nextLevel(level: GoalLevel): GoalLevel | null {
  return GOAL_LEVELS[LEVEL_RANK[level] + 1] ?? null;
}

type Node = { id: string; parentId: string | null };

/** True if setting `goalId`'s parent to `newParentId` would make a goal its own ancestor. */
export function wouldCreateCycle(goals: Node[], goalId: string, newParentId: string | null): boolean {
  if (!newParentId) return false;
  if (newParentId === goalId) return true;
  const parentOf = new Map(goals.map((g) => [g.id, g.parentId]));
  let cur: string | null | undefined = newParentId;
  let guard = 0;
  while (cur && guard++ < 1000) {
    if (cur === goalId) return true;
    cur = parentOf.get(cur);
  }
  return false;
}

export type HierarchyIssue = { code: string; message: string };

export function validateParent(
  child: { id?: string; level: GoalLevel; startDate: string; targetDate: string },
  parent: { id: string; level: GoalLevel; startDate: string; targetDate: string } | null,
  all: Node[],
): HierarchyIssue[] {
  const issues: HierarchyIssue[] = [];
  if (child.targetDate < child.startDate) {
    issues.push({ code: "dates", message: "Target date must be on or after the start date." });
  }
  if (!parent) return issues;
  if (!isValidChildLevel(parent.level, child.level)) {
    issues.push({
      code: "level",
      message: `A ${child.level} goal cannot sit under a ${parent.level} goal. Children must be a shorter horizon than their parent.`,
    });
  }
  if (child.id && wouldCreateCycle(all, child.id, parent.id)) {
    issues.push({ code: "cycle", message: "That parent is already below this goal; the hierarchy would loop." });
  }
  if (child.startDate < parent.startDate || child.targetDate > parent.targetDate) {
    issues.push({
      code: "window",
      message: `Dates fall outside the parent's window (${parent.startDate} – ${parent.targetDate}).`,
    });
  }
  return issues;
}

/** Ids of a goal and all of its descendants. */
export function descendantIds(goals: Node[], rootId: string): Set<string> {
  const kids = new Map<string, string[]>();
  for (const g of goals) {
    if (!g.parentId) continue;
    kids.set(g.parentId, [...(kids.get(g.parentId) ?? []), g.id]);
  }
  const out = new Set<string>();
  const stack = [rootId];
  while (stack.length) {
    const id = stack.pop()!;
    if (out.has(id)) continue;
    out.add(id);
    stack.push(...(kids.get(id) ?? []));
  }
  return out;
}

/** Chain from the root down to (and including) the given goal. */
export function ancestry<T extends Node>(goals: T[], id: string): T[] {
  const byId = new Map(goals.map((g) => [g.id, g]));
  const chain: T[] = [];
  let cur = byId.get(id);
  let guard = 0;
  while (cur && guard++ < 100) {
    chain.unshift(cur);
    cur = cur.parentId ? byId.get(cur.parentId) : undefined;
  }
  return chain;
}
