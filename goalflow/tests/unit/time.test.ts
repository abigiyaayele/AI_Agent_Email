import { describe, expect, it } from "vitest";
import { availableWorkingDays, expectedPct, forecastCompletion, paceStatus, requiredHoursPerDay, requiredRate } from "@/lib/domain/pace";
import { dayBounds, localToInstant, periodContaining, shiftPeriod, subPeriods } from "@/lib/domain/periods";
import { nextOccurrence, occurrencesBetween } from "@/lib/domain/recurrence";
import { computeNextFire, fireKey, nextSystemFire } from "@/lib/domain/reminders";
import { elapsedMs, finish, minutesWithin, pause, resume } from "@/lib/domain/timer";
import { adjustedEstimate, estimationAccuracy, goalRemainingHours, historicalFactor, remainingMinutes } from "@/lib/domain/estimation";

describe("periods", () => {
  it("computes week bounds in the user's zone with a configurable week start", () => {
    const mon = periodContaining("week", "2026-10-28", "America/New_York", 1);
    expect(mon.start).toBe("2026-10-26");
    expect(mon.end).toBe("2026-11-01");
    const sun = periodContaining("week", "2026-10-28", "America/New_York", 7);
    expect(sun.start).toBe("2026-10-25");
  });
  it("computes quarter, half and year boundaries and rollovers", () => {
    expect(periodContaining("quarter", "2026-11-15", "UTC").start).toBe("2026-10-01");
    expect(periodContaining("half", "2026-11-15", "UTC").start).toBe("2026-07-01");
    expect(periodContaining("half", "2026-11-15", "UTC").end).toBe("2026-12-31");
    const dec = periodContaining("month", "2026-12-10", "UTC");
    expect(shiftPeriod(dec, 1, "UTC").start).toBe("2027-01-01");
    const lastWeek = periodContaining("week", "2026-12-30", "UTC");
    expect(shiftPeriod(lastWeek, 1, "UTC").start).toBe("2027-01-04");
    expect(subPeriods(periodContaining("quarter", "2026-02-01", "UTC"), "month", "UTC")).toHaveLength(3);
  });
  it("handles DST: a day can be 23 hours long", () => {
    const { start, end } = dayBounds("2026-03-08", "America/New_York");
    expect((end.getTime() - start.getTime()) / 3_600_000).toBe(23);
  });
  it("converts local wall-clock to UTC instants per zone", () => {
    expect(localToInstant("2026-07-01", "09:00", "Europe/Berlin").toISOString()).toBe("2026-07-01T07:00:00.000Z");
    expect(localToInstant("2026-01-01", "09:00", "Europe/Berlin").toISOString()).toBe("2026-01-01T08:00:00.000Z");
  });
});

describe("pace", () => {
  it("required effort = remaining hours / available working days", () => {
    const days = availableWorkingDays("2026-10-26", "2026-11-06", [1, 2, 3, 4, 5]);
    expect(days).toBe(10);
    expect(requiredHoursPerDay(25, days)).toBe(2.5);
    expect(requiredHoursPerDay(5, 0)).toBeNull();
  });
  it("quantity pace: 24 books in 12 months is 2 per month", () => {
    expect(requiredRate(24, "2026-01-01", "2026-12-31", "month")).toBe(2);
  });
  it("classifies pace against a linear plan", () => {
    expect(expectedPct("2026-01-01", "2026-12-31", "2026-07-02")).toBeCloseTo(50, 0);
    expect(paceStatus(50, "2026-01-01", "2026-12-31", "2026-07-02")).toBe("on_track");
    expect(paceStatus(20, "2026-01-01", "2026-12-31", "2026-07-02")).toBe("at_risk");
    expect(paceStatus(100, "2026-01-01", "2026-12-31", "2026-07-02")).toBe("complete");
  });
  it("forecasts only from enough measured history", () => {
    expect(forecastCompletion([{ at: new Date("2026-01-01"), value: 0 }], 10, "increase")).toBeNull();
    const f = forecastCompletion(
      [
        { at: new Date("2026-01-01"), value: 0 },
        { at: new Date("2026-01-11"), value: 5 },
      ],
      10,
      "increase",
    );
    expect(f!.date.toISOString().slice(0, 10)).toBe("2026-01-21");
  });
});

describe("recurrence", () => {
  it("keeps local time across DST transitions", () => {
    const rule = { freq: "daily" as const, interval: 1, startLocal: "2026-03-07T09:00", timezone: "America/New_York" };
    const occ = occurrencesBetween(rule, new Date("2026-03-07T00:00Z"), new Date("2026-03-10T00:00Z"));
    expect(occ.map((d) => d.toISOString())).toEqual([
      "2026-03-07T14:00:00.000Z",
      "2026-03-08T13:00:00.000Z",
      "2026-03-09T13:00:00.000Z",
    ]);
  });
  it("supports weekly rules on specific weekdays and counts", () => {
    const rule = { freq: "weekly" as const, interval: 1, byWeekday: [1, 3], startLocal: "2026-10-26T07:30", timezone: "UTC", count: 3 };
    const occ = occurrencesBetween(rule, new Date("2026-10-01Z"), new Date("2026-12-01Z"));
    expect(occ.map((d) => d.toISOString().slice(0, 10))).toEqual(["2026-10-26", "2026-10-28", "2026-11-02"]);
  });
  it("skips months without the requested day", () => {
    const rule = { freq: "monthly" as const, interval: 1, startLocal: "2026-01-31T10:00", timezone: "UTC" };
    expect(nextOccurrence(rule, new Date("2026-02-01Z"))!.toISOString().slice(0, 10)).toBe("2026-03-31");
  });
});

describe("reminders", () => {
  const prefs = { timezone: "Europe/London", dailyPlanTime: "08:00", dailyReviewTime: "20:00", weeklyReviewDay: 7 };
  it("schedules daily and period review reminders in the user's zone", () => {
    expect(nextSystemFire("daily_plan", prefs, new Date("2026-10-25T09:00Z"))!.toISOString()).toBe("2026-10-26T08:00:00.000Z");
    expect(nextSystemFire("weekly_review", prefs, new Date("2026-10-26T00:00Z"))!.toISOString()).toBe("2026-11-01T20:00:00.000Z");
    expect(nextSystemFire("monthly_review", prefs, new Date("2026-10-31T21:00Z"))!.toISOString()).toBe("2026-11-30T20:00:00.000Z");
    expect(nextSystemFire("quarterly_review", prefs, new Date("2026-10-01T00:00Z"))!.toISOString()).toBe("2026-12-31T20:00:00.000Z");
  });
  it("task reminders are one-off and stop when done or past", () => {
    const task = { scheduledStart: new Date("2026-10-26T10:00Z"), dueAt: null, status: "todo" };
    const r = { kind: "task_start" as const, offsetMinutes: 15, rule: null, fixedAt: null, task };
    expect(computeNextFire(r, prefs, new Date("2026-10-26T09:00Z"))!.toISOString()).toBe("2026-10-26T09:45:00.000Z");
    expect(computeNextFire(r, prefs, new Date("2026-10-26T09:50Z"))).toBeNull();
    expect(computeNextFire({ ...r, task: { ...task, status: "done" } }, prefs, new Date("2026-10-26T09:00Z"))).toBeNull();
  });
  it("fire keys are stable for retries", () => {
    const at = new Date("2026-10-26T09:45Z");
    expect(fireKey("r1", at)).toBe(fireKey("r1", new Date(at.getTime())));
  });
});

describe("timer", () => {
  const t0 = new Date("2026-10-26T09:00:00Z");
  const at = (min: number) => new Date(t0.getTime() + min * 60_000);
  it("derives elapsed time from stored timestamps (survives refresh)", () => {
    let s = { startedAt: t0, endedAt: null as Date | null, pausedAt: null as Date | null, pausedMs: 0 };
    s = { ...s, ...pause(s, at(10)) };
    // A refresh 30 minutes later still shows 10 minutes because the pause is stored.
    expect(elapsedMs(s, at(40))).toBe(10 * 60_000);
    s = { ...s, ...resume(s, at(40)) };
    s = { ...s, ...finish(s, at(55)) };
    expect(elapsedMs(s, at(500))).toBe(25 * 60_000);
  });
  it("rejects invalid transitions", () => {
    const s = { startedAt: t0, endedAt: null, pausedAt: null, pausedMs: 0 };
    expect(() => resume(s, at(1))).toThrow();
    const done = { ...s, endedAt: at(5) };
    expect(() => pause(done, at(6))).toThrow();
  });
  it("clips sessions to a window for timesheets", () => {
    const s = { startedAt: new Date("2026-10-26T23:30:00Z"), endedAt: new Date("2026-10-27T00:30:00Z"), pausedAt: null, pausedMs: 0 };
    expect(minutesWithin(s, new Date("2026-10-27T00:00:00Z"), new Date("2026-10-28T00:00:00Z"))).toBe(30);
  });
});

describe("estimation", () => {
  it("computes remaining effort and goal remaining hours", () => {
    expect(remainingMinutes({ status: "todo", estimatedMinutes: 60, actualMinutes: 20, remainingMinutes: null })).toBe(40);
    expect(remainingMinutes({ status: "todo", estimatedMinutes: 60, actualMinutes: 90, remainingMinutes: null })).toBe(0);
    expect(remainingMinutes({ status: "done", estimatedMinutes: 60, actualMinutes: 0, remainingMinutes: null })).toBe(0);
    expect(goalRemainingHours({ estimatedHours: 10 }, [], 120).hours).toBe(8);
  });
  it("uses history only when enough samples exist", () => {
    const four = Array.from({ length: 4 }, () => ({ estimatedMinutes: 60, actualMinutes: 90 }));
    expect(historicalFactor(four)).toBeNull();
    const five = [...four, { estimatedMinutes: 60, actualMinutes: 90 }];
    expect(historicalFactor(five)).toBe(1.5);
    expect(adjustedEstimate(60, 1.5)).toEqual({ minutes: 90, basis: "history" });
    expect(adjustedEstimate(60, null).basis).toBe("assumption");
    expect(estimationAccuracy(five).withinTwentyPct).toBe(0);
  });
});
