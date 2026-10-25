import { DateTime } from "luxon";
import type { PeriodType } from "@/lib/constants";

/**
 * Calendar periods are computed in the user's time zone. Dates are ISO `yyyy-MM-dd` strings,
 * instants are UTC `Date`s. `end` is the last day of the period (inclusive) and
 * `endExclusive` is the first instant after it, which is what range queries should use.
 */
export type Period = {
  type: PeriodType;
  start: string;
  end: string;
  startInstant: Date;
  endExclusive: Date;
  label: string;
};

export function nowIn(tz: string, now: Date = new Date()): DateTime {
  const dt = DateTime.fromJSDate(now, { zone: tz });
  return dt.isValid ? dt : DateTime.fromJSDate(now, { zone: "UTC" });
}

export function isValidTimeZone(tz: string): boolean {
  return DateTime.local().setZone(tz).isValid;
}

export function todayIn(tz: string, now: Date = new Date()): string {
  return nowIn(tz, now).toISODate()!;
}

function startOfWeek(dt: DateTime, weekStartsOn: number): DateTime {
  const diff = (dt.weekday - weekStartsOn + 7) % 7;
  return dt.startOf("day").minus({ days: diff });
}

export function periodContaining(type: PeriodType, date: string, tz: string, weekStartsOn = 1): Period {
  const d = DateTime.fromISO(date, { zone: tz }).startOf("day");
  let start: DateTime;
  let next: DateTime;
  switch (type) {
    case "day":
      start = d;
      next = d.plus({ days: 1 });
      break;
    case "week":
      start = startOfWeek(d, weekStartsOn);
      next = start.plus({ weeks: 1 });
      break;
    case "month":
      start = d.startOf("month");
      next = start.plus({ months: 1 });
      break;
    case "quarter":
      start = d.startOf("quarter");
      next = start.plus({ months: 3 });
      break;
    case "half":
      start = d.set({ month: d.month <= 6 ? 1 : 7 }).startOf("month");
      next = start.plus({ months: 6 });
      break;
    case "year":
      start = d.startOf("year");
      next = start.plus({ years: 1 });
      break;
  }
  const last = next.minus({ days: 1 });
  return {
    type,
    start: start.toISODate()!,
    end: last.toISODate()!,
    startInstant: start.toJSDate(),
    endExclusive: next.toJSDate(),
    label: periodLabel(type, start, last),
  };
}

export function shiftPeriod(p: Period, steps: number, tz: string, weekStartsOn = 1): Period {
  const s = DateTime.fromISO(p.start, { zone: tz });
  const unit: Record<PeriodType, Parameters<DateTime["plus"]>[0]> = {
    day: { days: steps },
    week: { weeks: steps },
    month: { months: steps },
    quarter: { months: 3 * steps },
    half: { months: 6 * steps },
    year: { years: steps },
  };
  return periodContaining(p.type, s.plus(unit[p.type]).toISODate()!, tz, weekStartsOn);
}

function periodLabel(type: PeriodType, start: DateTime, last: DateTime): string {
  switch (type) {
    case "day":
      return start.toFormat("cccc, d LLL yyyy");
    case "week":
      return `Week of ${start.toFormat("d LLL")} – ${last.toFormat("d LLL yyyy")}`;
    case "month":
      return start.toFormat("LLLL yyyy");
    case "quarter":
      return `Q${start.quarter} ${start.year}`;
    case "half":
      return `${start.month === 1 ? "H1" : "H2"} ${start.year}`;
    case "year":
      return String(start.year);
  }
}

/** Child periods of a period, e.g. the months of a quarter. */
export function subPeriods(p: Period, childType: PeriodType, tz: string, weekStartsOn = 1): Period[] {
  const out: Period[] = [];
  let cur = periodContaining(childType, p.start, tz, weekStartsOn);
  let guard = 0;
  while (cur.start <= p.end && guard++ < 400) {
    out.push(cur);
    cur = shiftPeriod(cur, 1, tz, weekStartsOn);
  }
  return out;
}

/** Inclusive list of ISO dates between two ISO dates. */
export function eachDate(from: string, to: string): string[] {
  const out: string[] = [];
  let d = DateTime.fromISO(from, { zone: "UTC" });
  const end = DateTime.fromISO(to, { zone: "UTC" });
  let guard = 0;
  while (d <= end && guard++ < 3700) {
    out.push(d.toISODate()!);
    d = d.plus({ days: 1 });
  }
  return out;
}

export function isoWeekday(date: string): number {
  return DateTime.fromISO(date, { zone: "UTC" }).weekday;
}

/** Convert a local wall-clock date + "HH:mm" in a zone to a UTC instant (DST-aware). */
export function localToInstant(date: string, time: string, tz: string): Date {
  const [h, m] = time.split(":").map(Number);
  return DateTime.fromISO(date, { zone: tz })
    .set({ hour: h ?? 0, minute: m ?? 0, second: 0, millisecond: 0 })
    .toJSDate();
}

export function instantToLocal(instant: Date, tz: string): { date: string; time: string } {
  const dt = nowIn(tz, instant);
  return { date: dt.toISODate()!, time: dt.toFormat("HH:mm") };
}

export function dayBounds(date: string, tz: string): { start: Date; end: Date } {
  const s = DateTime.fromISO(date, { zone: tz }).startOf("day");
  return { start: s.toJSDate(), end: s.plus({ days: 1 }).toJSDate() };
}

export function addDays(date: string, days: number): string {
  return DateTime.fromISO(date, { zone: "UTC" }).plus({ days }).toISODate()!;
}

export function daysBetween(from: string, to: string): number {
  return Math.round(DateTime.fromISO(to, { zone: "UTC" }).diff(DateTime.fromISO(from, { zone: "UTC" }), "days").days);
}

export function formatInstant(instant: Date | string | null | undefined, tz: string, fmt = "d LLL, HH:mm"): string {
  if (!instant) return "";
  const d = typeof instant === "string" ? new Date(instant) : instant;
  return nowIn(tz, d).toFormat(fmt);
}

export function formatDate(date: string | null | undefined, fmt = "d LLL yyyy"): string {
  if (!date) return "";
  return DateTime.fromISO(date, { zone: "UTC" }).toFormat(fmt);
}
