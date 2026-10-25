import { and, eq, gte, lt, or, sql } from "drizzle-orm";
import { z } from "zod";
import type { PeriodType } from "@/lib/constants";
import { periodContaining, shiftPeriod, subPeriods, todayIn, type Period } from "@/lib/domain/periods";
import { computePeriodMetrics, ruleBasedSummary, type PeriodMetrics, type ReviewGoal, type ReviewSession, type ReviewTask } from "@/lib/domain/review";
import { aiProvider, AiUnavailableError } from "@/server/ai/provider";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { audit } from "./audit";
import { loadGoalForest } from "./goals";

type Prefs = s.Preferences;

/** Which goal levels a review of each horizon looks at. */
const LEVELS_FOR: Record<PeriodType, s.Goal["level"][]> = {
  day: ["week", "month"],
  week: ["week", "month"],
  month: ["month", "quarter"],
  quarter: ["quarter", "half"],
  half: ["half", "year"],
  year: ["year"],
};
const CHILD: Record<PeriodType, PeriodType | null> = { day: null, week: "day", month: "week", quarter: "month", half: "quarter", year: "month" };

async function loadInputs(userId: string, from: Date, to: Date) {
  const [tasks, sessions] = await Promise.all([
    db()
      .select()
      .from(s.tasks)
      .where(
        and(
          eq(s.tasks.userId, userId),
          or(
            and(gte(sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt})`, from), lt(sql`coalesce(${s.tasks.scheduledStart}, ${s.tasks.dueAt})`, to)),
            and(gte(s.tasks.completedAt, from), lt(s.tasks.completedAt, to)),
          ),
        ),
      ),
    db()
      .select()
      .from(s.workSessions)
      .where(and(eq(s.workSessions.userId, userId), lt(s.workSessions.startedAt, to), or(sql`${s.workSessions.endedAt} is null`, sql`${s.workSessions.endedAt} > ${from}`))),
  ]);
  const reviewTasks: ReviewTask[] = tasks.map((t) => ({
    id: t.id,
    title: t.title,
    status: t.status,
    priority: t.priority,
    goalId: t.goalId,
    scheduledStart: t.scheduledStart,
    dueAt: t.dueAt,
    completedAt: t.completedAt,
    estimatedMinutes: t.estimatedMinutes,
    actualMinutes: t.actualMinutes,
    carryOverCount: t.carryOverCount,
  }));
  const reviewSessions: ReviewSession[] = sessions.map((w) => ({ startedAt: w.startedAt, endedAt: w.endedAt, pausedAt: w.pausedAt, pausedMs: w.pausedMs, taskId: w.taskId, kind: w.kind }));
  return { tasks: reviewTasks, sessions: reviewSessions, raw: tasks };
}

/** Everything a planning/review page needs, computed from stored data for one period. */
export async function periodReview(userId: string, prefs: Prefs, type: PeriodType, date: string, now = new Date()) {
  const tz = prefs.timezone;
  const period = periodContaining(type, date, tz, prefs.weekStartsOn);
  const prev = shiftPeriod(period, -1, tz, prefs.weekStartsOn);
  const today = todayIn(tz, now);
  // Expected progress is measured at the end of the period (or today, if the period is current).
  const asOf = today < period.start ? period.start : today > period.end ? period.end : today;

  const [inputs, prevInputs, forest, report, notes] = await Promise.all([
    loadInputs(userId, period.startInstant, period.endExclusive),
    loadInputs(userId, prev.startInstant, prev.endExclusive),
    loadGoalForest(userId, asOf),
    db()
      .select()
      .from(s.reviewReports)
      .where(and(eq(s.reviewReports.userId, userId), eq(s.reviewReports.periodType, type), eq(s.reviewReports.periodStart, period.start)))
      .then((r) => r[0] ?? null),
    db()
      .select({ id: s.notes.id, title: s.notes.title, body: s.notes.body, kind: s.notes.kind, journalDate: s.notes.journalDate })
      .from(s.notes)
      .where(
        and(
          eq(s.notes.userId, userId),
          or(
            and(eq(s.notes.kind, "journal"), gte(s.notes.journalDate, period.start), sql`${s.notes.journalDate} <= ${period.end}`),
            and(sql`${s.notes.kind} <> 'journal'`, gte(s.notes.updatedAt, period.startInstant), lt(s.notes.updatedAt, period.endExclusive)),
          ),
        ),
      )
      .limit(50),
  ]);

  const levels = LEVELS_FOR[type];
  const goals = forest.goals.filter(
    (g) => levels.includes(g.level) && g.status !== "abandoned" && g.startDate <= period.end && g.targetDate >= period.start,
  );
  const reviewGoals: ReviewGoal[] = goals.map((g) => ({ id: g.id, title: g.title, category: g.category, level: g.level, pct: g.progress.pct, expectedPct: g.expected }));
  const goalCategory = new Map(forest.goals.map((g) => [g.id, g.category]));
  const metrics = computePeriodMetrics({ ...inputs, goals: reviewGoals, goalCategory }, period.startInstant, period.endExclusive, now);
  const prevMetrics = computePeriodMetrics({ ...prevInputs, goals: [], goalCategory }, prev.startInstant, prev.endExclusive, now);
  const child = CHILD[type];
  const breakdown = child
    ? subPeriods(period, child, tz, prefs.weekStartsOn).map((p) => ({
        period: p,
        metrics: computePeriodMetrics({ ...inputs, goals: [], goalCategory }, p.startInstant, p.endExclusive, now),
      }))
    : [];
  const goalTitles = new Map(forest.goals.map((g) => [g.id, g.title]));
  const nonEmptyNotes = notes.filter((n) => n.body.trim() || n.title.trim());

  return { period, prev, metrics, prevMetrics, breakdown, goals, report, notes: nonEmptyNotes, goalTitles, tasks: inputs.raw };
}

export const ReflectionSchema = z.object({
  wins: z.string().trim().max(5000).default(""),
  obstacles: z.string().trim().max(5000).default(""),
  lessons: z.string().trim().max(5000).default(""),
  decisions: z.string().trim().max(5000).default(""),
  nextPriorities: z.string().trim().max(5000).default(""),
});

async function upsertReport(userId: string, period: Period, patch: Partial<typeof s.reviewReports.$inferInsert>) {
  const [row] = await db()
    .insert(s.reviewReports)
    .values({ userId, periodType: period.type, periodStart: period.start, periodEnd: period.end, ...patch })
    .onConflictDoUpdate({
      target: [s.reviewReports.userId, s.reviewReports.periodType, s.reviewReports.periodStart],
      set: { ...patch, updatedAt: new Date() },
    })
    .returning();
  return row!;
}

/** Save the user's written reflection together with a snapshot of the metrics it refers to. */
export async function saveReflection(userId: string, prefs: Prefs, type: PeriodType, date: string, input: z.infer<typeof ReflectionSchema>) {
  const r = await periodReview(userId, prefs, type, date);
  const row = await upsertReport(userId, r.period, { ...input, metrics: snapshot(r.metrics) });
  await audit(db(), userId, "review", row.id, "review.saved", { periodType: type, periodStart: r.period.start });
  return row;
}

function snapshot(m: PeriodMetrics) {
  return {
    planned: m.planned,
    completed: m.completed,
    completionRate: m.completionRate,
    onTimeRate: m.onTimeRate,
    focusMinutes: m.focusMinutes,
    breakMinutes: m.breakMinutes,
    plannedMinutes: m.plannedMinutes,
    unfinished: m.unfinished.length,
  };
}

const AiSummarySchema = z.object({
  summary: z.string().describe("Two to four plain sentences describing how the period went."),
  done: z.array(z.string()).describe("Completed work worth noting, using the task titles provided."),
  notDone: z.array(z.string()).describe("Unfinished work and why it matters, using the task titles provided."),
  timeInsight: z.string().describe("One sentence on where the time went compared with the estimates."),
  suggestions: z.array(z.string()).describe("Up to three concrete next steps for the next period."),
});

function fmtMin(m: number) {
  return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m`;
}

/**
 * Summarise a period: done and undone tasks, time, goals and notes. Uses the configured AI
 * provider when available and the deterministic rules otherwise. The AI only receives this
 * user's own aggregated data, and its output is validated before it is stored.
 */
export async function generateSummary(userId: string, prefs: Prefs, type: PeriodType, date: string) {
  const r = await periodReview(userId, prefs, type, date);
  const m = r.metrics;
  const rules = ruleBasedSummary(r.period.label, m, r.notes);
  const provider = aiProvider();
  let text = rules;
  let source: "rules" | "ai" = "rules";
  let warning: string | null = null;
  if (provider) {
    try {
      const facts = {
        period: r.period.label,
        planned: m.planned,
        completedPlanned: m.completedPlanned,
        completionRatePct: m.completionRate,
        onTimeRatePct: m.onTimeRate,
        focus: fmtMin(m.focusMinutes),
        estimatedForPlanned: fmtMin(m.plannedMinutes),
        breaks: fmtMin(m.breakMinutes),
        done: m.done.slice(0, 30).map((t) => ({ title: t.title, actual: fmtMin(t.actualMinutes), estimate: t.estimatedMinutes ? fmtMin(t.estimatedMinutes) : null })),
        notDone: m.unfinished.slice(0, 30).map((t) => ({ title: t.title, status: t.status, priority: t.priority, timesCarriedOver: t.carryOverCount })),
        timeByGoal: Object.entries(m.minutesByGoal).map(([id, min]) => ({ goal: r.goalTitles.get(id) ?? "Goal", time: fmtMin(min) })),
        goals: m.goals.map((g) => ({ title: g.title, progressPct: g.pct, expectedPct: g.expectedPct })),
        previousPeriod: { completionRatePct: r.prevMetrics.completionRate, focus: fmtMin(r.prevMetrics.focusMinutes) },
        notes: r.notes.slice(0, 10).map((n) => ({ title: n.title, excerpt: n.body.slice(0, 400) })),
      };
      const out = await provider.generate({
        system:
          "You write short, honest, encouraging productivity reviews for one person using only the facts given. Never invent tasks, numbers or events. Refer to tasks by the titles given. Plain language, no markdown headings.",
        prompt: `Write the review for this period. Facts (JSON):\n${JSON.stringify(facts)}`,
        schema: AiSummarySchema,
        maxTokens: 4000,
      });
      const clip = (v: string, n = 600) => v.trim().slice(0, n);
      const list = (xs: string[]) => xs.slice(0, 10).map((x) => `• ${clip(x, 300)}`).join("\n");
      text = [
        clip(out.summary, 1200),
        out.done.length ? `Done:\n${list(out.done)}` : "",
        out.notDone.length ? `Not done:\n${list(out.notDone)}` : "",
        clip(out.timeInsight),
        out.suggestions.length ? `Next:\n${list(out.suggestions.slice(0, 3))}` : "",
      ]
        .filter(Boolean)
        .join("\n\n");
      source = "ai";
    } catch (err) {
      warning = err instanceof AiUnavailableError ? err.message : "The AI service could not be reached.";
      console.error("[ai] summary failed, using rules", err);
    }
  }
  await upsertReport(userId, r.period, { summary: text, summarySource: source, metrics: snapshot(m) });
  return { text, source, warning };
}
