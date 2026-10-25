import { DateTime } from "luxon";
import { daysBetween, eachDate, isoWeekday } from "./periods";

export type PaceStatus = "not_started" | "ahead" | "on_track" | "behind" | "at_risk" | "overdue" | "complete";

/** Share of the time window that has elapsed on `today`, 0..1. */
export function elapsedFraction(startDate: string, targetDate: string, today: string): number {
  const total = daysBetween(startDate, targetDate) + 1;
  if (total <= 0) return 1;
  const elapsed = daysBetween(startDate, today) + 1;
  return Math.min(1, Math.max(0, elapsed / total));
}

/** Expected progress (0..100) assuming a linear plan. */
export function expectedPct(startDate: string, targetDate: string, today: string): number {
  if (today < startDate) return 0;
  return Math.round(elapsedFraction(startDate, targetDate, today) * 1000) / 10;
}

export function paceStatus(actualPct: number, startDate: string, targetDate: string, today: string): PaceStatus {
  if (actualPct >= 100) return "complete";
  if (today < startDate) return "not_started";
  if (today > targetDate) return "overdue";
  const gap = expectedPct(startDate, targetDate, today) - actualPct;
  if (gap <= -5) return "ahead";
  if (gap <= 10) return "on_track";
  if (gap <= 25) return "behind";
  return "at_risk";
}

export const PACE_LABEL: Record<PaceStatus, string> = {
  not_started: "Not started",
  ahead: "Ahead of pace",
  on_track: "On track",
  behind: "Behind",
  at_risk: "At risk",
  overdue: "Past target date",
  complete: "Complete",
};

/** Number of working days from `from` to `to` inclusive. */
export function availableWorkingDays(from: string, to: string, workingDays: number[]): number {
  if (to < from) return 0;
  const set = new Set(workingDays);
  return eachDate(from, to).filter((d) => set.has(isoWeekday(d))).length;
}

/**
 * Baseline: required effort per available day = remaining estimated hours / working days left.
 * Returns null when no working days remain (the deadline cannot be met by pacing alone).
 */
export function requiredHoursPerDay(remainingHours: number, availableDays: number): number | null {
  if (remainingHours <= 0) return 0;
  if (availableDays <= 0) return null;
  return Math.round((remainingHours / availableDays) * 100) / 100;
}

export type RateUnit = "day" | "week" | "month";

/** For quantity goals: e.g. 24 books over 12 months -> 2 per month. */
export function requiredRate(remainingQuantity: number, from: string, to: string, unit: RateUnit): number | null {
  if (remainingQuantity <= 0) return 0;
  const a = DateTime.fromISO(from, { zone: "UTC" });
  const b = DateTime.fromISO(to, { zone: "UTC" }).plus({ days: 1 });
  const span = unit === "month" ? b.diff(a, "months").months : unit === "week" ? b.diff(a, "weeks").weeks : b.diff(a, "days").days;
  if (span <= 0) return null;
  return Math.round((remainingQuantity / span) * 100) / 100;
}

export type Point = { at: Date; value: number };

/**
 * Forecast when a numeric target will be reached from measured history (least squares).
 * Returns null when there is not enough data or no movement in the right direction.
 */
export function forecastCompletion(
  history: Point[],
  target: number,
  direction: "increase" | "decrease",
): { date: Date; ratePerDay: number } | null {
  const pts = [...history].sort((a, b) => a.at.getTime() - b.at.getTime());
  if (pts.length < 2) return null;
  const t0 = pts[0]!.at.getTime();
  const xs = pts.map((p) => (p.at.getTime() - t0) / 86_400_000);
  const ys = pts.map((p) => p.value);
  if (xs[xs.length - 1]! < 1) return null;
  const n = xs.length;
  const mx = xs.reduce((s, x) => s + x, 0) / n;
  const my = ys.reduce((s, y) => s + y, 0) / n;
  let num = 0;
  let den = 0;
  for (let i = 0; i < n; i++) {
    num += (xs[i]! - mx) * (ys[i]! - my);
    den += (xs[i]! - mx) ** 2;
  }
  if (den === 0) return null;
  const slope = num / den;
  if ((direction === "increase" && slope <= 0) || (direction === "decrease" && slope >= 0)) return null;
  const last = pts[pts.length - 1]!;
  const remaining = target - last.value;
  const days = remaining / slope;
  if (days < 0) return { date: last.at, ratePerDay: slope };
  return { date: new Date(last.at.getTime() + days * 86_400_000), ratePerDay: slope };
}
