import { z } from "zod";
import { DIRECTIONS, GOAL_CATEGORIES, GOAL_LEVELS, GOAL_STATUSES, METRIC_TYPES, PRIORITIES } from "@/lib/constants";
import { isoDate, optionalNumber, optionalUuid, trimmed } from "./common";

export const GoalSchema = z
  .object({
    title: trimmed(200).min(1, "Give the goal a name"),
    description: trimmed(5000).default(""),
    level: z.enum(GOAL_LEVELS),
    parentId: optionalUuid,
    category: z.enum(GOAL_CATEGORIES),
    startDate: isoDate,
    targetDate: isoDate,
    metricType: z.enum(METRIC_TYPES),
    unit: trimmed(40).default(""),
    direction: z.enum(DIRECTIONS).default("increase"),
    startValue: optionalNumber.transform((v) => v ?? 0),
    targetValue: optionalNumber,
    currentValue: optionalNumber.transform((v) => v ?? 0),
    priority: z.enum(PRIORITIES).default("medium"),
    status: z.enum(GOAL_STATUSES).default("active"),
    estimatedHours: optionalNumber.refine((v) => v === null || (v >= 0 && v <= 100000), "Must be between 0 and 100000"),
    weight: optionalNumber.transform((v) => v ?? 1).refine((v) => v >= 0 && v <= 1000, "Weight must be between 0 and 1000"),
  })
  .refine((g) => g.targetDate >= g.startDate, { path: ["targetDate"], message: "Target date must be on or after the start date" })
  .refine((g) => g.metricType !== "numeric" || g.targetValue !== null, {
    path: ["targetValue"],
    message: "A measurable goal needs a target value",
  })
  .refine((g) => g.metricType !== "numeric" || g.targetValue !== g.startValue, {
    path: ["targetValue"],
    message: "Target must differ from the starting value",
  })
  .refine(
    (g) =>
      g.metricType !== "numeric" ||
      g.targetValue === null ||
      (g.direction === "increase" ? g.targetValue > g.startValue : g.targetValue < g.startValue),
    { path: ["direction"], message: "Direction does not match start and target values" },
  );
export type GoalInput = z.infer<typeof GoalSchema>;

export const MilestoneSchema = z.object({
  title: trimmed(200).min(1, "Name the milestone"),
  dueDate: isoDate.optional().or(z.literal("")).transform((v) => v || null),
  weight: optionalNumber.transform((v) => v ?? 1).refine((v) => v > 0 && v <= 1000, "Weight must be positive"),
});

export const ProgressUpdateSchema = z.object({
  value: z.coerce.number().refine(Number.isFinite, "Enter a number"),
  note: trimmed(500).optional().default(""),
});

export const BreakdownSchema = z
  .object({
    title: trimmed(200).min(1, "Name your goal"),
    description: trimmed(5000).default(""),
    category: z.enum(GOAL_CATEGORIES),
    outcome: trimmed(500).min(1, "Describe the outcome you want"),
    unit: trimmed(40).min(1, "What will you measure? e.g. books, kg, $"),
    direction: z.enum(DIRECTIONS),
    startValue: z.coerce.number(),
    targetValue: z.coerce.number(),
    startDate: isoDate,
    targetDate: isoDate,
    estimatedHours: z.coerce.number().min(1, "Estimate at least 1 hour").max(10000),
    milestones: z.array(z.object({ title: trimmed(200).min(1), weight: z.coerce.number().positive().max(1000) })).max(20).default([]),
    sessionsPerWeek: z.coerce.number().int().min(0).max(21),
    sessionMinutes: z.coerce.number().int().min(5).max(480),
    dailyAction: trimmed(200).default(""),
    weeksForMonths: z.coerce.number().int().min(0).max(3).default(1),
    useAi: z.boolean().default(false),
  })
  .refine((b) => b.targetDate > b.startDate, { path: ["targetDate"], message: "Target date must be after the start date" })
  .refine((b) => b.targetValue !== b.startValue, { path: ["targetValue"], message: "Target must differ from the starting value" })
  .refine((b) => (b.direction === "increase" ? b.targetValue > b.startValue : b.targetValue < b.startValue), {
    path: ["direction"],
    message: "Direction does not match start and target values",
  });
export type BreakdownRequest = z.infer<typeof BreakdownSchema>;

/** The reviewed plan the user approves. Keys link drafts together before ids exist. */
export const ApplyPlanSchema = z.object({
  category: z.enum(GOAL_CATEGORIES),
  description: trimmed(5000).default(""),
  goals: z
    .array(
      z.object({
        key: z.string().min(1).max(100),
        parentKey: z.string().max(100).nullable(),
        level: z.enum(GOAL_LEVELS),
        title: trimmed(200).min(1),
        startDate: isoDate,
        targetDate: isoDate,
        startValue: z.number(),
        targetValue: z.number(),
        unit: trimmed(40),
        direction: z.enum(DIRECTIONS),
        estimatedHours: z.number().min(0).max(100000),
        include: z.boolean(),
      }),
    )
    .min(1)
    .max(200),
  milestones: z.array(z.object({ title: trimmed(200).min(1), weight: z.number().positive() })).max(20),
  tasks: z
    .array(
      z.object({
        key: z.string().max(100),
        goalKey: z.string().max(100),
        title: trimmed(200).min(1),
        date: isoDate,
        estimatedMinutes: z.number().int().min(5).max(720),
        priority: z.enum(PRIORITIES),
        include: z.boolean(),
      }),
    )
    .max(60),
});
export type ApplyPlan = z.infer<typeof ApplyPlanSchema>;
