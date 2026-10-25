import { z } from "zod";
import { PRIORITIES, RECURRENCE_FREQS, TASK_STATUSES } from "@/lib/constants";
import { checkbox, isoDate, optionalInt, optionalUuid, trimmed } from "./common";

const localDateTime = z
  .string()
  .optional()
  .transform((v) => (v ? v : null))
  .pipe(z.string().regex(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/, "Use a valid date and time").nullable());

const reminderOffset = z
  .string()
  .optional()
  .transform((v) => (v === undefined || v === "" || v === "none" ? null : Number(v)))
  .pipe(z.number().int().min(0).max(10080).nullable());

export const TaskSchema = z
  .object({
    title: trimmed(300).min(1, "Give the task a title"),
    description: trimmed(10000).default(""),
    notes: trimmed(20000).default(""),
    status: z.enum(TASK_STATUSES).default("todo"),
    priority: z.enum(PRIORITIES).default("medium"),
    goalId: optionalUuid,
    milestoneId: optionalUuid,
    parentTaskId: optionalUuid,
    scheduledStart: localDateTime,
    durationMinutes: optionalInt.refine((v) => v === null || (v >= 5 && v <= 24 * 60), "Duration must be 5 min to 24 h"),
    dueAt: localDateTime,
    estimatedMinutes: optionalInt.refine((v) => v === null || (v >= 1 && v <= 100000), "Estimate must be positive"),
    remainingMinutes: optionalInt.refine((v) => v === null || (v >= 0 && v <= 100000), "Must be zero or more"),
    allowOverlap: checkbox,
    startReminder: reminderOffset,
    deadlineReminder: reminderOffset,
    recurrenceFreq: z.union([z.enum(RECURRENCE_FREQS), z.literal("none")]).default("none"),
    recurrenceInterval: optionalInt.transform((v) => v ?? 1).refine((v) => v >= 1 && v <= 52, "Interval 1–52"),
    recurrenceDays: z.array(z.coerce.number().int().min(1).max(7)).default([]),
    recurrenceUntil: isoDate.optional().or(z.literal("")).transform((v) => v || null),
  })
  .refine((t) => t.recurrenceFreq === "none" || t.scheduledStart, {
    path: ["scheduledStart"],
    message: "Recurring tasks need a start date and time",
  })
  .refine((t) => !t.scheduledStart || t.durationMinutes || t.estimatedMinutes, {
    path: ["durationMinutes"],
    message: "Scheduled tasks need a duration or an estimate",
  })
  .refine((t) => t.startReminder === null || t.scheduledStart, { path: ["startReminder"], message: "Set a start time for a start reminder" })
  .refine((t) => t.deadlineReminder === null || t.dueAt, { path: ["deadlineReminder"], message: "Set a deadline for a deadline reminder" });
export type TaskInput = z.infer<typeof TaskSchema>;

export const QuickTaskSchema = z.object({
  title: trimmed(300).min(1, "Type a task"),
  date: isoDate.optional().or(z.literal("")).transform((v) => v || null),
  time: z
    .string()
    .optional()
    .transform((v) => v || null)
    .pipe(z.string().regex(/^\d{2}:\d{2}$/).nullable()),
  estimatedMinutes: optionalInt,
  goalId: optionalUuid,
  priority: z.enum(PRIORITIES).default("medium"),
});
