import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { generateBreakdown } from "@/lib/domain/breakdown";
import { closeDb, db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { applyPlan, createGoal, deleteGoal, getGoalDetail, GoalError, loadGoalForest, recordProgress, updateGoal } from "@/server/services/goals";
import { getPreferences } from "@/server/services/account";
import type { GoalInput } from "@/lib/validation/goal";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

const base = (over: Partial<GoalInput>): GoalInput => ({
  title: "Goal",
  description: "",
  level: "year",
  parentId: null,
  category: "education",
  startDate: "2026-01-01",
  targetDate: "2026-12-31",
  metricType: "numeric",
  unit: "books",
  direction: "increase",
  startValue: 0,
  targetValue: 24,
  currentValue: 0,
  priority: "high",
  status: "active",
  estimatedHours: 100,
  weight: 1,
  ...over,
});

describe("goal hierarchy", () => {
  it("creates linked goals and validates level, window and cycles", async () => {
    const u = await makeUser();
    const year = await createGoal(u.id, base({ title: "Read 24 books" }));
    const q1 = await createGoal(u.id, base({ title: "Q1", level: "quarter", parentId: year.id, startDate: "2026-01-01", targetDate: "2026-03-31", targetValue: 6 }));
    const jan = await createGoal(u.id, base({ title: "Jan", level: "month", parentId: q1.id, startDate: "2026-01-01", targetDate: "2026-01-31", targetValue: 2 }));

    await expect(createGoal(u.id, base({ title: "bad level", level: "year", parentId: jan.id }))).rejects.toBeInstanceOf(GoalError);
    await expect(
      createGoal(u.id, base({ title: "outside", level: "month", parentId: q1.id, startDate: "2026-05-01", targetDate: "2026-05-31" })),
    ).rejects.toThrow(/outside the parent/);
    // Making the yearly goal a child of its own grandchild is rejected (level and cycle).
    await expect(updateGoal(u.id, year.id, base({ title: "Read 24 books", level: "week", parentId: jan.id, startDate: "2026-01-01", targetDate: "2026-01-07" }))).rejects.toBeInstanceOf(GoalError);
  });

  it("the database itself refuses cycles even if the service is bypassed", async () => {
    const u = await makeUser();
    const a = await createGoal(u.id, base({ title: "A" }));
    const b = await createGoal(u.id, base({ title: "B", level: "half", parentId: a.id, startDate: "2026-01-01", targetDate: "2026-06-30" }));
    await expect(db().update(s.goals).set({ parentId: b.id }).where(eq(s.goals.id, a.id))).rejects.toThrow();
  });

  it("does not allow linking to another user's goal", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const theirs = await createGoal(b.id, base({ title: "B goal" }));
    await expect(createGoal(a.id, base({ title: "mine", level: "month", parentId: theirs.id, startDate: "2026-01-01", targetDate: "2026-01-31" }))).rejects.toThrow(
      /not found/,
    );
    expect((await loadGoalForest(a.id, "2026-06-01")).goals).toHaveLength(0);
  });

  it("rolls progress up through children and flows measured values to cumulative sub-targets", async () => {
    const u = await makeUser();
    const year = await createGoal(u.id, base({ title: "Read 24 books" }));
    const h1 = await createGoal(u.id, base({ title: "H1", level: "half", parentId: year.id, startDate: "2026-01-01", targetDate: "2026-06-30", targetValue: 12 }));
    await recordProgress(u.id, year.id, 6, "6 books so far");
    const { goals } = await loadGoalForest(u.id, "2026-04-01");
    expect(goals.find((g) => g.id === year.id)!.progress.pct).toBe(25);
    expect(goals.find((g) => g.id === h1.id)!.progress.pct).toBe(50);
    const snaps = await db().select().from(s.progressSnapshots).where(eq(s.progressSnapshots.goalId, year.id));
    expect(snaps.at(-1)!.value).toBe(6);
  });

  it("deleting with reparent keeps children and moves tasks up", async () => {
    const u = await makeUser();
    const year = await createGoal(u.id, base({ title: "Y" }));
    const q = await createGoal(u.id, base({ title: "Q", level: "quarter", parentId: year.id, startDate: "2026-01-01", targetDate: "2026-03-31" }));
    const m = await createGoal(u.id, base({ title: "M", level: "month", parentId: q.id, startDate: "2026-01-01", targetDate: "2026-01-31" }));
    const [t] = await db().insert(s.tasks).values({ userId: u.id, goalId: q.id, title: "task" }).returning();
    await deleteGoal(u.id, q.id, "reparent");
    const [mAfter] = await db().select().from(s.goals).where(eq(s.goals.id, m.id));
    expect(mAfter!.parentId).toBe(year.id);
    const [tAfter] = await db().select().from(s.tasks).where(eq(s.tasks.id, t!.id));
    expect(tAfter!.goalId).toBe(year.id);
  });

  it("applies an approved breakdown plan in one transaction", async () => {
    const u = await makeUser();
    const prefs = await getPreferences(u.id);
    const draft = generateBreakdown(
      {
        title: "Run 1000 km",
        category: "fitness",
        outcome: "Run 1000 km",
        unit: "km",
        direction: "increase",
        startValue: 0,
        targetValue: 1000,
        startDate: "2026-01-01",
        targetDate: "2026-12-31",
        estimatedHours: 120,
        milestones: [{ title: "First half marathon", weight: 2 }],
        sessionsPerWeek: 3,
        sessionMinutes: 40,
        dailyAction: "Run 5 km",
        weeksForMonths: 1,
      },
      prefs,
      "2026-01-01",
    );
    const res = await applyPlan(
      u.id,
      {
        category: "fitness",
        description: "",
        goals: draft.goals.map((g) => ({ ...g, include: true })),
        milestones: draft.milestones,
        tasks: draft.tasks.map((t) => ({ ...t, include: true })),
      },
      "UTC",
    );
    const goals = await db().select().from(s.goals).where(eq(s.goals.userId, u.id));
    expect(goals.length).toBe(draft.goals.length);
    expect(res.tasks).toBe(draft.tasks.length);
    const detail = await getGoalDetail(u.id, res.rootId, prefs);
    expect(detail!.milestones).toHaveLength(1);
    expect(detail!.children).toHaveLength(2);

    // A plan whose included child points at an excluded parent is rejected before writing.
    await expect(
      applyPlan(
        u.id,
        {
          category: "fitness",
          description: "",
          goals: draft.goals.map((g) => ({ ...g, include: g.level !== "half" })),
          milestones: [],
          tasks: [],
        },
        "UTC",
      ),
    ).rejects.toBeInstanceOf(GoalError);
  });
});
