import { and, eq, inArray } from "drizzle-orm";
import { z } from "zod";
import { PRIORITY_RANK } from "@/lib/constants";
import { addDays, dayBounds, eachDate, todayIn } from "@/lib/domain/periods";
import { dailyCapacityMinutes, plannedMinutes, workloadByDay } from "@/lib/domain/scheduling";
import { aiProvider, AiUnavailableError } from "@/server/ai/provider";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { loadGoalForest } from "./goals";
import { toLoadTask } from "./tasks";

type Prefs = s.Preferences;

export type Risk = { level: "high" | "medium"; text: string; href?: string };
export type Contribution = { goalId: string; goalTitle: string; pct: number; expected: number; tasks: { id: string; title: string; minutes: number; sharePct: number }[] };

const OPEN = ["todo", "in_progress", "blocked"] as const;

/**
 * Deterministic assistant: always available, no AI key needed. Picks the next task, lists risks and
 * explains how open tasks contribute to goals. The AI layer (below) can only add suggestions on top.
 */
export async function assistantBrief(userId: string, prefs: Prefs, now = new Date()) {
  const tz = prefs.timezone;
  const today = todayIn(tz, now);
  const horizon = eachDate(today, addDays(today, 13));
  const [open, forest] = await Promise.all([
    db().select().from(s.tasks).where(and(eq(s.tasks.userId, userId), inArray(s.tasks.status, [...OPEN]))),
    loadGoalForest(userId, today),
  ]);
  const goalById = new Map(forest.goals.map((g) => [g.id, g]));
  const endToday = dayBounds(today, tz).end;
  const behind = new Set(forest.goals.filter((g) => ["behind", "at_risk", "overdue"].includes(g.pace)).map((g) => g.id));

  // Next task: overdue or due/scheduled today first, then priority, then goals that are behind, then earliest deadline.
  const score = (t: s.Task) => {
    const anchor = t.scheduledStart ?? t.dueAt;
    const urgent = anchor && anchor < endToday ? 0 : 1;
    return [t.status === "blocked" ? 1 : 0, urgent, PRIORITY_RANK[t.priority], t.goalId && behind.has(t.goalId) ? 0 : 1, (t.dueAt ?? new Date(8.64e15)).getTime()];
  };
  const ranked = [...open].sort((a, b) => {
    const x = score(a);
    const y = score(b);
    for (let i = 0; i < x.length; i++) if (x[i] !== y[i]) return (x[i] as number) - (y[i] as number);
    return 0;
  });
  const next = ranked[0] ?? null;
  const nextReasons: string[] = [];
  if (next) {
    const anchor = next.scheduledStart ?? next.dueAt;
    if (next.dueAt && next.dueAt < now) nextReasons.push("it is overdue");
    else if (anchor && anchor < endToday) nextReasons.push("it is planned for today");
    if (next.priority === "critical" || next.priority === "high") nextReasons.push(`it is ${next.priority} priority`);
    if (next.goalId && behind.has(next.goalId)) nextReasons.push(`its goal “${goalById.get(next.goalId)?.title}” is behind pace`);
    if (!nextReasons.length) nextReasons.push("it is your highest-ranked open task");
  }

  const risks: Risk[] = [];
  for (const g of forest.goals) {
    if (g.status !== "active") continue;
    if (g.pace === "overdue") risks.push({ level: "high", text: `“${g.title}” passed its target date at ${Math.round(g.progress.pct)}%.`, href: `/goals/${g.id}` });
    else if (g.pace === "at_risk" || g.pace === "behind")
      risks.push({ level: g.pace === "at_risk" ? "high" : "medium", text: `“${g.title}” is at ${Math.round(g.progress.pct)}%; ${Math.round(g.expected)}% was expected by today.`, href: `/goals/${g.id}` });
  }
  const loads = workloadByDay(horizon, tz, open.map(toLoadTask), prefs);
  const overloaded = loads.filter((l) => l.overload > 0);
  if (overloaded.length)
    risks.push({ level: overloaded.length > 2 ? "high" : "medium", text: `${overloaded.length} day${overloaded.length === 1 ? " is" : "s are"} over capacity in the next two weeks (worst: ${overloaded.sort((a, b) => b.overload - a.overload)[0]!.date}).`, href: "/calendar" });
  const overdue = open.filter((t) => t.dueAt && t.dueAt < now);
  if (overdue.length) risks.push({ level: "high", text: `${overdue.length} task${overdue.length === 1 ? " is" : "s are"} overdue.`, href: "/tasks?view=overdue" });
  const blocked = open.filter((t) => t.status === "blocked");
  if (blocked.length) risks.push({ level: "medium", text: `${blocked.length} task${blocked.length === 1 ? " is" : "s are"} blocked.`, href: "/tasks?status=blocked" });
  for (const t of open.filter((t) => t.carryOverCount >= 3).slice(0, 3))
    risks.push({ level: "medium", text: `“${t.title}” has been carried over ${t.carryOverCount} times; consider splitting it or lowering its scope.`, href: `/tasks/${t.id}` });

  // How open tasks contribute to the goals that need it most.
  const contributions: Contribution[] = forest.goals
    .filter((g) => g.status === "active" && open.some((t) => t.goalId === g.id))
    .sort((a, b) => a.progress.pct - a.expected - (b.progress.pct - b.expected))
    .slice(0, 4)
    .map((g) => {
      const ts = open.filter((t) => t.goalId === g.id);
      const total = ts.reduce((sum, t) => sum + plannedMinutes(toLoadTask(t)), 0) || 1;
      return {
        goalId: g.id,
        goalTitle: g.title,
        pct: Math.round(g.progress.pct),
        expected: Math.round(g.expected),
        tasks: ts
          .map((t) => ({ id: t.id, title: t.title, minutes: plannedMinutes(toLoadTask(t)), sharePct: Math.round((plannedMinutes(toLoadTask(t)) / total) * 100) }))
          .sort((a, b) => b.minutes - a.minutes)
          .slice(0, 5),
      };
    });

  return {
    next: next ? { id: next.id, title: next.title, reasons: nextReasons } : null,
    risks: risks.sort((a, b) => (a.level === b.level ? 0 : a.level === "high" ? -1 : 1)),
    contributions,
    loads,
    openCount: open.length,
    capacityToday: dailyCapacityMinutes(today, prefs),
  };
}

const AdviceSchema = z.object({
  overview: z.string().describe("Two or three sentences on the current situation."),
  nextTaskId: z.string().nullable().describe("The id of the task to do next, from the tasks list, or null."),
  nextTaskReason: z.string(),
  risks: z.array(z.string()).describe("Up to four concrete risks, referring to goals and tasks by name."),
  moves: z
    .array(z.object({ taskId: z.string(), toDate: z.string().describe("YYYY-MM-DD"), reason: z.string() }))
    .describe("Optional recovery moves: reschedule open, non-critical tasks to days with spare capacity."),
});

export type AiAdvice = {
  overview: string;
  next: { id: string; title: string; reason: string } | null;
  risks: string[];
  moves: { taskId: string; title: string; fromDate: string | null; toDate: string; reason: string }[];
};

/**
 * Optional AI recovery advice. Output is validated against the user's real data: unknown task ids,
 * critical tasks, done tasks and dates outside the next 14 days are discarded. Nothing is changed
 * until the user approves specific moves.
 */
export async function aiAdvice(userId: string, prefs: Prefs, now = new Date()): Promise<AiAdvice | { error: string }> {
  const provider = aiProvider();
  if (!provider) return { error: "AI is not configured on this server. The suggestions above are always available without it." };
  const tz = prefs.timezone;
  const today = todayIn(tz, now);
  const brief = await assistantBrief(userId, prefs, now);
  const open = await db().select().from(s.tasks).where(and(eq(s.tasks.userId, userId), inArray(s.tasks.status, [...OPEN])));
  const forest = await loadGoalForest(userId, today);
  const local = (d: Date | null) => (d ? new Intl.DateTimeFormat("en-CA", { timeZone: tz }).format(d) : null);
  const facts = {
    today,
    capacityMinutesPerDay: brief.loads.map((l) => ({ date: l.date, capacity: l.capacity, planned: l.planned })),
    tasks: open.slice(0, 80).map((t) => ({
      id: t.id,
      title: t.title,
      priority: t.priority,
      status: t.status,
      date: local(t.scheduledStart ?? t.dueAt),
      deadline: local(t.dueAt),
      minutes: plannedMinutes(toLoadTask(t)),
      goal: t.goalId ? forest.goals.find((g) => g.id === t.goalId)?.title : null,
      carriedOver: t.carryOverCount,
    })),
    goals: forest.goals.filter((g) => g.status === "active").slice(0, 30).map((g) => ({ title: g.title, level: g.level, progressPct: Math.round(g.progress.pct), expectedPct: Math.round(g.expected), target: g.targetDate })),
  };
  let out: z.infer<typeof AdviceSchema>;
  try {
    out = await provider.generate({
      system:
        "You are GoalFlow's planning assistant for one person. Use only the facts given; never invent tasks or numbers. Never move critical tasks or change deadlines. Suggest moves only to days where planned + task minutes stays within capacity.",
      prompt: `Advise on what to do next and how to recover if behind. Facts (JSON):\n${JSON.stringify(facts)}`,
      schema: AdviceSchema,
      maxTokens: 6000,
    });
  } catch (err) {
    return { error: err instanceof AiUnavailableError ? err.message : "The AI service could not be reached. Try again later." };
  }
  const byId = new Map(open.map((t) => [t.id, t]));
  const last = addDays(today, 14);
  const seen = new Set<string>();
  const moves = out.moves
    .filter((m) => {
      const t = byId.get(m.taskId);
      if (!t || t.priority === "critical" || seen.has(m.taskId)) return false;
      if (!/^\d{4}-\d{2}-\d{2}$/.test(m.toDate) || m.toDate < today || m.toDate > last) return false;
      seen.add(m.taskId);
      return true;
    })
    .slice(0, 15)
    .map((m) => {
      const t = byId.get(m.taskId)!;
      return { taskId: t.id, title: t.title, fromDate: local(t.scheduledStart ?? t.dueAt), toDate: m.toDate, reason: m.reason.slice(0, 300) };
    })
    .filter((m) => m.fromDate !== m.toDate);
  const nextTask = out.nextTaskId ? byId.get(out.nextTaskId) : undefined;
  return {
    overview: out.overview.slice(0, 1200),
    next: nextTask ? { id: nextTask.id, title: nextTask.title, reason: out.nextTaskReason.slice(0, 400) } : null,
    risks: out.risks.slice(0, 4).map((r) => r.slice(0, 300)),
    moves,
  };
}
