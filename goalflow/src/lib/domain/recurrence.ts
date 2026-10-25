import { DateTime } from "luxon";
import type { RecurrenceFreq } from "@/lib/constants";

export type RecurrenceRule = {
  freq: RecurrenceFreq;
  interval: number;
  /** ISO weekdays (1 = Monday) for weekly rules. Defaults to the start's weekday. */
  byWeekday?: number[] | null;
  /** Day of month for monthly rules. Defaults to the start's day; months without it are skipped. */
  byMonthDay?: number | null;
  /** Local wall-clock start, `yyyy-MM-ddTHH:mm`, interpreted in `timezone`. */
  startLocal: string;
  timezone: string;
  untilDate?: string | null;
  count?: number | null;
};

const MAX_ITER = 5000;

/**
 * Generate occurrences as UTC instants. Wall-clock time is kept constant across daylight-saving
 * changes (a 09:00 reminder stays at 09:00 local). Non-existent local times (spring-forward gap)
 * are shifted forward by Luxon.
 */
export function* occurrences(rule: RecurrenceRule): Generator<Date> {
  const start = DateTime.fromISO(rule.startLocal, { zone: rule.timezone });
  if (!start.isValid) return;
  const interval = Math.max(1, rule.interval);
  const until = rule.untilDate ? DateTime.fromISO(rule.untilDate, { zone: rule.timezone }).endOf("day") : null;
  let emitted = 0;
  const atTime = (d: DateTime) =>
    DateTime.fromObject(
      { year: d.year, month: d.month, day: d.day, hour: start.hour, minute: start.minute },
      { zone: rule.timezone },
    );
  const emit = function* (d: DateTime): Generator<Date, boolean> {
    if (d < start) return true;
    if (until && d > until) return false;
    if (rule.count && emitted >= rule.count) return false;
    emitted++;
    yield d.toJSDate();
    return true;
  };

  for (let i = 0; i < MAX_ITER; i++) {
    if (rule.freq === "daily") {
      const d = atTime(start.plus({ days: i * interval }));
      if (!(yield* emit(d))) return;
    } else if (rule.freq === "weekly") {
      const days = (rule.byWeekday?.length ? [...rule.byWeekday] : [start.weekday]).sort((a, b) => a - b);
      const weekStart = start.startOf("day").minus({ days: start.weekday - 1 }).plus({ weeks: i * interval });
      for (const wd of days) {
        const d = atTime(weekStart.plus({ days: wd - 1 }));
        if (!(yield* emit(d))) return;
      }
    } else if (rule.freq === "monthly") {
      const dom = rule.byMonthDay ?? start.day;
      const m = start.startOf("month").plus({ months: i * interval });
      if (dom <= (m.daysInMonth ?? 31)) {
        if (!(yield* emit(atTime(m.set({ day: dom }))))) return;
      }
    } else {
      const y = start.plus({ years: i * interval });
      if (y.month === start.month && y.day === start.day) {
        if (!(yield* emit(atTime(y)))) return;
      }
    }
  }
}

/** First occurrence strictly after `after`, or null if the rule has ended. */
export function nextOccurrence(rule: RecurrenceRule, after: Date): Date | null {
  for (const d of occurrences(rule)) {
    if (d.getTime() > after.getTime()) return d;
  }
  return null;
}

export function occurrencesBetween(rule: RecurrenceRule, from: Date, to: Date, limit = 500): Date[] {
  const out: Date[] = [];
  for (const d of occurrences(rule)) {
    if (d >= to) break;
    if (d >= from) out.push(d);
    if (out.length >= limit) break;
  }
  return out;
}

export function describeRule(rule: Pick<RecurrenceRule, "freq" | "interval" | "byWeekday" | "byMonthDay">): string {
  const n = rule.interval > 1 ? `every ${rule.interval} ` : "every ";
  const names = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
  switch (rule.freq) {
    case "daily":
      return rule.interval > 1 ? `${n}days` : "Daily";
    case "weekly":
      return `${rule.interval > 1 ? `${n}weeks` : "Weekly"}${rule.byWeekday?.length ? ` on ${rule.byWeekday.map((d) => names[d]).join(", ")}` : ""}`;
    case "monthly":
      return `${rule.interval > 1 ? `${n}months` : "Monthly"}${rule.byMonthDay ? ` on day ${rule.byMonthDay}` : ""}`;
    case "yearly":
      return rule.interval > 1 ? `${n}years` : "Yearly";
  }
}
