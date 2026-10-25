import { DateTime } from "luxon";
import type { ReminderKind } from "@/lib/constants";
import { nextOccurrence, type RecurrenceRule } from "./recurrence";

export type ReminderPrefs = {
  timezone: string;
  dailyPlanTime: string;
  dailyReviewTime: string;
  weeklyReviewDay: number;
};

/** Idempotency key for a reminder occurrence: retries produce the same key, so no duplicates. */
export function fireKey(reminderId: string, fireAt: Date): string {
  return `${reminderId}:${fireAt.toISOString()}`;
}

function atLocal(d: DateTime, time: string, tz: string): DateTime {
  const [h, m] = time.split(":").map(Number);
  return DateTime.fromObject({ year: d.year, month: d.month, day: d.day, hour: h ?? 0, minute: m ?? 0 }, { zone: tz });
}

/**
 * Next fire instant for the built-in planning/review reminders, strictly after `after`.
 * Period reviews fire on the last day of the period at the user's review time.
 */
export function nextSystemFire(kind: ReminderKind, prefs: ReminderPrefs, after: Date): Date | null {
  const tz = prefs.timezone;
  const base = DateTime.fromJSDate(after, { zone: tz });
  const candidates = (fn: (d: DateTime) => DateTime | null, stepUnit: "days" | "months", horizon: number) => {
    for (let i = 0; i <= horizon; i++) {
      const c = fn(base.plus({ [stepUnit]: i }));
      if (c && c.toMillis() > after.getTime()) return c.toJSDate();
    }
    return null;
  };
  switch (kind) {
    case "daily_plan":
      return candidates((d) => atLocal(d, prefs.dailyPlanTime, tz), "days", 2);
    case "daily_review":
      return candidates((d) => atLocal(d, prefs.dailyReviewTime, tz), "days", 2);
    case "weekly_review":
      return candidates((d) => (d.weekday === prefs.weeklyReviewDay ? atLocal(d, prefs.dailyReviewTime, tz) : null), "days", 8);
    case "monthly_review":
      return candidates((d) => atLocal(d.endOf("month"), prefs.dailyReviewTime, tz), "months", 2);
    case "quarterly_review":
      return candidates((d) => (d.month % 3 === 0 ? atLocal(d.endOf("month"), prefs.dailyReviewTime, tz) : null), "months", 4);
    case "half_review":
      return candidates((d) => (d.month % 6 === 0 ? atLocal(d.endOf("month"), prefs.dailyReviewTime, tz) : null), "months", 7);
    case "yearly_review":
      return candidates((d) => (d.month === 12 ? atLocal(d.endOf("month"), prefs.dailyReviewTime, tz) : null), "months", 13);
    default:
      return null;
  }
}

export type ReminderLike = {
  kind: ReminderKind;
  offsetMinutes: number | null;
  rule: RecurrenceRule | null;
  /** For one-off custom reminders: the requested fire time. */
  fixedAt: Date | null;
  task: { scheduledStart: Date | null; dueAt: Date | null; status: string } | null;
};

/**
 * Compute the next time a reminder should fire after `after`. Task reminders are one-off and are
 * cleared when the task is done or its time has passed.
 */
export function computeNextFire(r: ReminderLike, prefs: ReminderPrefs, after: Date): Date | null {
  switch (r.kind) {
    case "task_start": {
      if (!r.task?.scheduledStart || r.task.status === "done") return null;
      const at = new Date(r.task.scheduledStart.getTime() - (r.offsetMinutes ?? 0) * 60_000);
      return at > after ? at : null;
    }
    case "deadline": {
      if (!r.task?.dueAt || r.task.status === "done") return null;
      const at = new Date(r.task.dueAt.getTime() - (r.offsetMinutes ?? 0) * 60_000);
      return at > after ? at : null;
    }
    case "custom":
      if (r.rule) return nextOccurrence(r.rule, after);
      return r.fixedAt && r.fixedAt > after ? r.fixedAt : null;
    default:
      return nextSystemFire(r.kind, prefs, after);
  }
}

export const SYSTEM_REMINDERS: { kind: ReminderKind; title: string; body: string; url: string }[] = [
  { kind: "daily_plan", title: "Plan your day", body: "Pick today's top three priorities.", url: "/today" },
  { kind: "daily_review", title: "End-of-day review", body: "Review what got done and carry unfinished work forward.", url: "/plan/day" },
  { kind: "weekly_review", title: "Weekly review", body: "Compare this week's targets with your results.", url: "/plan/week" },
  { kind: "monthly_review", title: "Monthly review", body: "Check monthly goals and lessons learned.", url: "/plan/month" },
  { kind: "quarterly_review", title: "Quarterly review", body: "Evaluate quarterly milestones and risks.", url: "/plan/quarter" },
  { kind: "half_review", title: "Six-month review", body: "Evaluate half-year outcomes and strategy.", url: "/plan/half" },
  { kind: "yearly_review", title: "Yearly review", body: "Celebrate achievements and plan next year.", url: "/plan/year" },
];
