import { z } from "zod";
import { CHANNELS } from "@/lib/constants";
import { isValidTimeZone } from "@/lib/domain/periods";
import { checkbox, hhmm, trimmed } from "./common";

export const RegisterSchema = z.object({
  name: trimmed(80).min(1, "Enter your name"),
  email: z.string().trim().toLowerCase().email("Enter a valid email").max(200),
  password: z.string().min(10, "Use at least 10 characters").max(200),
  timezone: z.string().refine(isValidTimeZone, "Unknown time zone").default("UTC"),
});

export const LoginSchema = z.object({
  email: z.string().trim().toLowerCase().email("Enter a valid email"),
  password: z.string().min(1, "Enter your password"),
});

const weekday = z.coerce.number().int().min(1).max(7);
const hours = (max: number) => z.coerce.number().min(0).max(max);

export const PreferencesSchema = z
  .object({
    timezone: z.string().refine(isValidTimeZone, "Unknown time zone"),
    theme: z.enum(["system", "light", "dark"]),
    weekStartsOn: weekday,
    workingDays: z.array(weekday).min(1, "Pick at least one working day"),
    availableHoursPerDay: hours(24),
    maxDailyHours: hours(24),
    preferredStart: hhmm,
    preferredEnd: hhmm,
    sleepStart: hhmm,
    sleepEnd: hhmm,
    personalHoursPerDay: hours(24),
    breakMinutes: z.coerce.number().int().min(0).max(240),
    bufferMinutes: z.coerce.number().int().min(0).max(240),
    pomodoroFocusMinutes: z.coerce.number().int().min(5).max(180),
    pomodoroBreakMinutes: z.coerce.number().int().min(1).max(60),
    allowParallelTimers: checkbox,
    dailyPlanTime: hhmm,
    dailyReviewTime: hhmm,
    weeklyReviewDay: weekday,
    defaultChannels: z.array(z.enum(CHANNELS)).default(["in_app"]),
    emailReminders: checkbox,
  })
  .refine((p) => p.preferredEnd > p.preferredStart, { path: ["preferredEnd"], message: "End must be after start" })
  .refine((p) => p.maxDailyHours >= p.availableHoursPerDay, {
    path: ["maxDailyHours"],
    message: "Maximum daily workload must be at least your available hours",
  });

export const ScheduleSchema = z
  .object({
    label: trimmed(80).min(1, "Give it a name"),
    kind: z.enum(["commitment", "focus_block"]).default("commitment"),
    days: z.array(weekday).min(1, "Pick at least one day"),
    startTime: hhmm,
    endTime: hhmm,
  })
  .refine((s) => s.startTime !== s.endTime, { path: ["endTime"], message: "End must differ from start" });
