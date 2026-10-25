import { describe, expect, it } from "vitest";
import { generateBreakdown } from "@/lib/domain/breakdown";
import { isValidChildLevel, validateParent, wouldCreateCycle } from "@/lib/domain/hierarchy";
import { computePeriodMetrics, ruleBasedSummary } from "@/lib/domain/review";
import { assignLanes, commitmentsOn, findConflicts, findFreeSlot, proposeRebalance, workloadByDay } from "@/lib/domain/scheduling";
import { canTransition, carryOverPatch, statusPatch } from "@/lib/domain/tasks";

describe("goal hierarchy", () => {
  it("requires children to be a shorter horizon", () => {
    expect(isValidChildLevel("year", "month")).toBe(true);
    expect(isValidChildLevel("month", "quarter")).toBe(false);
    expect(isValidChildLevel("week", "week")).toBe(false);
  });
  it("detects cycles", () => {
    const goals = [
      { id: "a", parentId: null },
      { id: "b", parentId: "a" },
      { id: "c", parentId: "b" },
    ];
    expect(wouldCreateCycle(goals, "a", "c")).toBe(true);
    expect(wouldCreateCycle(goals, "c", "a")).toBe(false);
    expect(wouldCreateCycle(goals, "a", "a")).toBe(true);
  });
  it("validates date windows against the parent", () => {
    const parent = { id: "p", level: "year" as const, startDate: "2026-01-01", targetDate: "2026-12-31" };
    expect(validateParent({ level: "month", startDate: "2026-02-01", targetDate: "2026-02-28" }, parent, [])).toEqual([]);
    const issues = validateParent({ level: "month", startDate: "2025-12-01", targetDate: "2026-01-31" }, parent, []);
    expect(issues.map((i) => i.code)).toContain("window");
  });
});

describe("task status transitions", () => {
  it("sets and clears completion timestamps", () => {
    const now = new Date("2026-10-26T10:00Z");
    expect(statusPatch("todo", "done", now)).toEqual({ status: "done", completedAt: now });
    expect(statusPatch("done", "todo", now)).toEqual({ status: "todo", completedAt: null });
  });
  it("blocks invalid transitions", () => {
    expect(canTransition("done", "blocked")).toBe(false);
    expect(() => statusPatch("done", "deferred")).toThrow();
  });
});

describe("carry over", () => {
  it("moves scheduled work to the target day keeping time and duration, and counts it", () => {
    const t = {
      scheduledStart: new Date("2026-10-26T14:00Z"),
      scheduledEnd: new Date("2026-10-26T15:30Z"),
      dueAt: new Date("2026-10-30T17:00Z"),
      carryOverCount: 0,
      status: "in_progress" as const,
    };
    const p = carryOverPatch(t, "2026-10-28", "UTC");
    expect(p.scheduledStart!.toISOString()).toBe("2026-10-28T14:00:00.000Z");
    expect(p.scheduledEnd!.toISOString()).toBe("2026-10-28T15:30:00.000Z");
    expect(p.dueAt).toEqual(t.dueAt); // deadline untouched
    expect(p.carryOverCount).toBe(1);
  });
});

describe("scheduling", () => {
  it("detects overlapping tasks and commitments", () => {
    const c = commitmentsOn("2026-10-26", "UTC", [{ id: "1", label: "Class", days: [1], startTime: "10:00", endTime: "11:00" }]);
    const cand = { id: "t", label: "Task", start: new Date("2026-10-26T10:30Z"), end: new Date("2026-10-26T11:30Z") };
    expect(findConflicts(cand, c)).toHaveLength(1);
    const adjacent = { id: "t", label: "Task", start: new Date("2026-10-26T11:00Z"), end: new Date("2026-10-26T12:00Z") };
    expect(findConflicts(adjacent, c)).toHaveLength(0);
  });
  it("finds a free slot respecting buffers", () => {
    const busy = [{ id: "a", label: "a", start: new Date("2026-10-26T09:00Z"), end: new Date("2026-10-26T10:00Z") }];
    const slot = findFreeSlot("2026-10-26", "UTC", { preferredStart: "09:00", preferredEnd: "17:00", bufferMinutes: 10 }, busy, 60);
    expect(slot!.start.toISOString()).toBe("2026-10-26T10:10:00.000Z");
  });
  it("detects overload and proposes moving non-critical work without touching deadlines", () => {
    const prefs = { workingDays: [1, 2, 3, 4, 5], availableHoursPerDay: 2, maxDailyHours: 8 };
    const mk = (id: string, priority: "critical" | "low", min: number, due: string | null = null) => ({
      id,
      title: id,
      status: "todo" as const,
      priority,
      scheduledStart: new Date("2026-10-26T09:00Z"),
      scheduledEnd: new Date(new Date("2026-10-26T09:00Z").getTime() + min * 60_000),
      dueAt: due ? new Date(due) : null,
      estimatedMinutes: min,
      remaining: min,
    });
    const tasks = [mk("crit", "critical", 90), mk("low", "low", 60), mk("lowDue", "low", 30, "2026-10-26T18:00Z")];
    const loads = workloadByDay(["2026-10-26", "2026-10-27"], "UTC", tasks, prefs);
    expect(loads[0]!.overload).toBe(60);
    const { proposals, unresolved } = proposeRebalance(loads, tasks, "UTC", prefs);
    expect(proposals.map((p) => p.taskId)).toEqual(["low"]);
    expect(proposals[0]!.toDate).toBe("2026-10-27");
    expect(unresolved).toEqual([]);
  });
});

describe("breakdown", () => {
  it("generates a reviewable plan with cumulative targets and capped tasks", () => {
    const plan = generateBreakdown(
      {
        title: "Read 24 books",
        category: "education",
        outcome: "Read 24 books",
        unit: "books",
        direction: "increase",
        startValue: 0,
        targetValue: 24,
        startDate: "2026-01-01",
        targetDate: "2026-12-31",
        estimatedHours: 240,
        milestones: [],
        sessionsPerWeek: 5,
        sessionMinutes: 45,
        dailyAction: "Read 30 pages",
        weeksForMonths: 1,
      },
      { workingDays: [1, 2, 3, 4, 5], availableHoursPerDay: 2, maxDailyHours: 8 },
      "2026-01-01",
    );
    const levels = plan.goals.reduce<Record<string, number>>((m, g) => ({ ...m, [g.level]: (m[g.level] ?? 0) + 1 }), {});
    expect(levels).toMatchObject({ year: 1, half: 2, quarter: 4, month: 12 });
    expect(levels.week).toBeLessThanOrEqual(6);
    const june = plan.goals.find((g) => g.level === "month" && g.startDate === "2026-06-01")!;
    expect(june.targetValue).toBeCloseTo(12, 0);
    expect(plan.tasks.length).toBeLessThanOrEqual(14);
    expect(plan.tasks.length).toBeGreaterThan(0);
  });
});

describe("period metrics", () => {
  it("computes completion, time and summaries from records", () => {
    const from = new Date("2026-10-26T00:00Z");
    const to = new Date("2026-10-27T00:00Z");
    const base = { priority: "high" as const, goalId: "g1", dueAt: null, estimatedMinutes: 60, carryOverCount: 0 };
    const m = computePeriodMetrics(
      {
        tasks: [
          { ...base, id: "1", title: "Write intro", status: "done", scheduledStart: new Date("2026-10-26T09:00Z"), completedAt: new Date("2026-10-26T10:00Z"), actualMinutes: 50 },
          { ...base, id: "2", title: "Edit draft", status: "todo", scheduledStart: new Date("2026-10-26T11:00Z"), completedAt: null, actualMinutes: 0 },
        ],
        sessions: [
          { taskId: "1", kind: "focus", startedAt: new Date("2026-10-26T09:00Z"), endedAt: new Date("2026-10-26T09:50Z"), pausedAt: null, pausedMs: 0 },
          { taskId: null, kind: "break", startedAt: new Date("2026-10-26T09:50Z"), endedAt: new Date("2026-10-26T10:00Z"), pausedAt: null, pausedMs: 0 },
        ],
        goals: [],
        goalCategory: new Map([["g1", "career"]]),
      },
      from,
      to,
    );
    expect(m.completionRate).toBe(50);
    expect(m.focusMinutes).toBe(50);
    expect(m.breakMinutes).toBe(10);
    expect(m.minutesByCategory).toEqual({ career: 50 });
    const text = ruleBasedSummary("Today", m);
    expect(text).toContain("Write intro");
    expect(text).toContain("Edit draft (todo)");
  });
});

describe("calendar lanes", () => {
  it("puts overlapping blocks side by side and leaves separate blocks full width", () => {
    const lanes = assignLanes([
      { id: "a", start: 600, end: 660 },
      { id: "b", start: 600, end: 645 },
      { id: "c", start: 650, end: 700 },
      { id: "d", start: 800, end: 830 },
    ]);
    expect(lanes.get("a")).toEqual({ lane: 0, lanes: 2 });
    expect(lanes.get("b")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("c")).toEqual({ lane: 1, lanes: 2 });
    expect(lanes.get("d")).toEqual({ lane: 0, lanes: 1 });
  });
});
