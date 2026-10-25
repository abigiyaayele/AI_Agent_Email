import { DateTime } from "luxon";
import type { Direction, GoalCategory, GoalLevel, Priority } from "@/lib/constants";
import { availableWorkingDays } from "./pace";
import { addDays, isoWeekday } from "./periods";

export type BreakdownInput = {
  title: string;
  description?: string;
  category: GoalCategory;
  outcome: string;
  unit: string;
  direction: Direction;
  startValue: number;
  targetValue: number;
  startDate: string;
  targetDate: string;
  estimatedHours: number;
  /** Weighted milestones on the yearly goal. */
  milestones: { title: string; weight: number; dueDate?: string | null }[];
  /** How many focused sessions per week the user wants to commit. */
  sessionsPerWeek: number;
  sessionMinutes: number;
  /** Title template for proposed daily actions. */
  dailyAction: string;
  /** Generate weekly goals for this many upcoming months (keeps the plan reviewable). */
  weeksForMonths: number;
};

export type DraftTask = {
  key: string;
  goalKey: string;
  title: string;
  date: string;
  estimatedMinutes: number;
  priority: Priority;
};

export type DraftGoal = {
  key: string;
  parentKey: string | null;
  level: GoalLevel;
  title: string;
  startDate: string;
  targetDate: string;
  targetValue: number;
  startValue: number;
  unit: string;
  direction: Direction;
  estimatedHours: number;
};

export type DraftPlan = {
  goals: DraftGoal[];
  milestones: BreakdownInput["milestones"];
  tasks: DraftTask[];
  workload: {
    requiredHours: number;
    plannedHoursPerWeek: number;
    weeks: number;
    capacityHours: number;
    fits: boolean;
    message: string;
  };
};

type Capacity = { workingDays: number[]; availableHoursPerDay: number; maxDailyHours: number };

const round = (v: number, d = 1) => Math.round(v * 10 ** d) / 10 ** d;

/**
 * Split a yearly (or any long) goal into halves, quarters, months and near-term weeks with
 * cumulative linear targets, plus daily actions for the first week. Nothing is saved; the user
 * reviews and edits the draft first. Task generation is capped to the first week on purpose.
 */
export function generateBreakdown(input: BreakdownInput, cap: Capacity, today: string): DraftPlan {
  const goals: DraftGoal[] = [];
  const tasks: DraftTask[] = [];
  const s = DateTime.fromISO(input.startDate, { zone: "UTC" });
  const e = DateTime.fromISO(input.targetDate, { zone: "UTC" });
  const totalDays = Math.max(1, e.diff(s, "days").days + 1);
  const span = input.targetValue - input.startValue;
  const valueAt = (date: DateTime) => {
    const f = Math.min(1, Math.max(0, (date.diff(s, "days").days + 1) / totalDays));
    const v = input.startValue + span * f;
    // Whole-number goals (books, workouts) get whole-number checkpoints.
    return Number.isInteger(input.startValue) && Number.isInteger(input.targetValue) ? Math.round(v) : round(v, 2);
  };
  const hoursFor = (a: DateTime, b: DateTime) => round(input.estimatedHours * ((b.diff(a, "days").days + 1) / totalDays));

  const root: DraftGoal = {
    key: "root",
    parentKey: null,
    level: "year",
    title: input.title,
    startDate: input.startDate,
    targetDate: input.targetDate,
    targetValue: input.targetValue,
    startValue: input.startValue,
    unit: input.unit,
    direction: input.direction,
    estimatedHours: input.estimatedHours,
  };
  goals.push(root);

  const segment = (
    parent: DraftGoal,
    level: GoalLevel,
    months: number,
    label: (a: DateTime, i: number) => string,
  ): DraftGoal[] => {
    const out: DraftGoal[] = [];
    let a = DateTime.fromISO(parent.startDate, { zone: "UTC" });
    const end = DateTime.fromISO(parent.targetDate, { zone: "UTC" });
    let i = 0;
    while (a <= end && i < 24) {
      const next = a.plus({ months }).startOf("month");
      const b = DateTime.min(next.minus({ days: 1 }), end);
      const prevVal = valueAt(a.minus({ days: 1 }));
      const g: DraftGoal = {
        key: `${parent.key}.${level}${i}`,
        parentKey: parent.key,
        level,
        title: `${label(a, i)}: reach ${valueAt(b)} ${input.unit}`.trim(),
        startDate: a.toISODate()!,
        targetDate: b.toISODate()!,
        startValue: a <= s ? input.startValue : prevVal,
        targetValue: valueAt(b),
        unit: input.unit,
        direction: input.direction,
        estimatedHours: hoursFor(a, b),
      };
      out.push(g);
      a = b.plus({ days: 1 });
      i++;
    }
    return out;
  };

  const halves = segment(root, "half", 6, (_a, i) => `H${i + 1}`);
  goals.push(...halves);
  const quarters = halves.flatMap((h) => segment(h, "quarter", 3, (a) => `Q${Math.ceil(a.month / 3)} ${a.year}`));
  goals.push(...quarters);
  const months = quarters.flatMap((q) => segment(q, "month", 1, (a) => a.toFormat("LLLL yyyy")));
  goals.push(...months);

  const firstMonthIdx = Math.max(0, months.findIndex((m) => m.targetDate >= today));
  const weekMonths = months.slice(firstMonthIdx, firstMonthIdx + Math.max(0, input.weeksForMonths));
  const weeks: DraftGoal[] = [];
  for (const m of weekMonths) {
    let a = DateTime.fromISO(m.startDate, { zone: "UTC" });
    const end = DateTime.fromISO(m.targetDate, { zone: "UTC" });
    let i = 0;
    while (a <= end && i < 6) {
      const b = DateTime.min(a.plus({ days: 7 - a.weekday }), end);
      weeks.push({
        key: `${m.key}.week${i}`,
        parentKey: m.key,
        level: "week",
        title: `Week of ${a.toFormat("d LLL")}: reach ${valueAt(b)} ${input.unit}`.trim(),
        startDate: a.toISODate()!,
        targetDate: b.toISODate()!,
        startValue: valueAt(a.minus({ days: 1 })),
        targetValue: valueAt(b),
        unit: input.unit,
        direction: input.direction,
        estimatedHours: round((input.sessionsPerWeek * input.sessionMinutes) / 60),
      });
      a = b.plus({ days: 1 });
      i++;
    }
  }
  goals.push(...weeks);

  // Daily actions only for the first upcoming week, spread over working days.
  const workingDaysOf = (w: DraftGoal) => {
    const out: string[] = [];
    for (let d = w.startDate < today ? today : w.startDate; d <= w.targetDate; d = addDays(d, 1)) {
      if (cap.workingDays.includes(isoWeekday(d))) out.push(d);
    }
    return out;
  };
  // First upcoming week that still has a working day left.
  const firstWeek = weeks.find((w) => w.targetDate >= today && workingDaysOf(w).length > 0);
  if (firstWeek && input.sessionsPerWeek > 0) {
    const days = workingDaysOf(firstWeek);
    const n = Math.min(input.sessionsPerWeek, Math.max(days.length, 1) * 2, 14);
    for (let i = 0; i < n && days.length; i++) {
      tasks.push({
        key: `task${i}`,
        goalKey: firstWeek.key,
        title: input.dailyAction || `Work on ${input.title}`,
        date: days[i % days.length]!,
        estimatedMinutes: input.sessionMinutes,
        priority: "high",
      });
    }
  }

  const weeksTotal = Math.max(1, totalDays / 7);
  const workDays = availableWorkingDays(input.startDate < today ? today : input.startDate, input.targetDate, cap.workingDays);
  const capacityHours = round(workDays * Math.min(cap.availableHoursPerDay, cap.maxDailyHours));
  const plannedHoursPerWeek = round((input.sessionsPerWeek * input.sessionMinutes) / 60);
  const fits = input.estimatedHours <= capacityHours;
  const neededPerWeek = round(input.estimatedHours / weeksTotal);
  return {
    goals,
    milestones: input.milestones,
    tasks,
    workload: {
      requiredHours: input.estimatedHours,
      plannedHoursPerWeek,
      weeks: round(weeksTotal),
      capacityHours,
      fits,
      message: fits
        ? `${input.estimatedHours}h over ${round(weeksTotal)} weeks needs about ${neededPerWeek}h/week; you plan ${plannedHoursPerWeek}h/week and have about ${capacityHours}h of available time in this window.` +
          (plannedHoursPerWeek < neededPerWeek ? ` Your weekly commitment is below the required ${neededPerWeek}h/week — add sessions or extend the date.` : "")
        : `This goal needs ${input.estimatedHours}h but only about ${capacityHours}h of working time is available before ${input.targetDate}. Reduce the scope, extend the target date or raise your available hours.`,
    },
  };
}
