import { describe, expect, it } from "vitest";
import { computeTreeProgress, milestoneProgress, numericProgress, taskProgress, type GoalLike } from "@/lib/domain/progress";

const goal = (over: Partial<GoalLike>): GoalLike => ({
  id: "g",
  parentId: null,
  metricType: "numeric",
  direction: "increase",
  startValue: 0,
  targetValue: 100,
  currentValue: 0,
  weight: 1,
  status: "active",
  ...over,
});

describe("numericProgress", () => {
  it("measures increase goals from start to target", () => {
    expect(numericProgress(goal({ startValue: 0, targetValue: 24, currentValue: 6 })).pct).toBe(25);
  });
  it("supports inverse progress for lower-is-better goals", () => {
    // Reduce monthly expenses from 2000 to 1500; now at 1800 → 40%.
    const r = numericProgress(goal({ direction: "decrease", startValue: 2000, targetValue: 1500, currentValue: 1800 }));
    expect(r.pct).toBe(40);
  });
  it("clamps overshoot and regression", () => {
    expect(numericProgress(goal({ currentValue: 150 })).pct).toBe(100);
    expect(numericProgress(goal({ currentValue: -10 })).pct).toBe(0);
    expect(numericProgress(goal({ direction: "decrease", startValue: 80, targetValue: 70, currentValue: 85 })).pct).toBe(0);
  });
  it("handles missing target", () => {
    expect(numericProgress(goal({ targetValue: null })).pct).toBe(0);
  });
});

describe("milestoneProgress", () => {
  it("uses configured weights rather than counts", () => {
    const r = milestoneProgress([
      { goalId: "g", weight: 1, completedAt: new Date() },
      { goalId: "g", weight: 3, completedAt: null },
    ]);
    expect(r.pct).toBe(25);
  });
});

describe("taskProgress", () => {
  it("weights tasks by estimated effort and flags assumptions", () => {
    const r = taskProgress([
      { goalId: "g", status: "done", estimatedMinutes: 30, actualMinutes: 30 },
      { goalId: "g", status: "todo", estimatedMinutes: 90, actualMinutes: 0 },
      { goalId: "g", status: "deferred", estimatedMinutes: 600, actualMinutes: 0 },
    ]);
    expect(r.pct).toBe(25);
    expect(r.assumption).toBe(false);
    expect(taskProgress([{ goalId: "g", status: "done", estimatedMinutes: null, actualMinutes: 0 }]).assumption).toBe(true);
  });
});

describe("computeTreeProgress", () => {
  it("rolls up children by weight and ignores abandoned children", () => {
    const goals = [
      goal({ id: "y", metricType: "children" }),
      goal({ id: "a", parentId: "y", currentValue: 100, weight: 3 }),
      goal({ id: "b", parentId: "y", currentValue: 0, weight: 1 }),
      goal({ id: "c", parentId: "y", currentValue: 0, weight: 5, status: "abandoned" }),
    ];
    const m = computeTreeProgress(goals, [], []);
    expect(m.get("y")!.pct).toBe(75);
  });
  it("survives a corrupted cyclic hierarchy", () => {
    const goals = [goal({ id: "a", parentId: "b", metricType: "children" }), goal({ id: "b", parentId: "a", metricType: "children" })];
    expect(() => computeTreeProgress(goals, [], [])).not.toThrow();
  });
});
