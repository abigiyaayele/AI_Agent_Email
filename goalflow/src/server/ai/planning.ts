import "server-only";
import { z } from "zod";
import type { DraftPlan } from "@/lib/domain/breakdown";
import type { BreakdownRequest } from "@/lib/validation/goal";
import type { Preferences } from "@/server/db/schema";
import { aiProvider } from "./provider";

const PlanSuggestion = z.object({
  milestones: z.array(z.object({ title: z.string(), weight: z.number() })),
  goalTitles: z.array(z.object({ key: z.string(), title: z.string() })),
  tasks: z.array(
    z.object({
      title: z.string(),
      date: z.string(),
      estimatedMinutes: z.number(),
      priority: z.enum(["critical", "high", "medium", "low"]),
    }),
  ),
  notes: z.array(z.string()),
});

const SYSTEM = `You are GoalFlow's planning assistant. You turn a person's goal into concrete, measurable
milestones and realistic actions. Keep titles short (under 80 characters), specific and action-oriented.
Never invent progress or data. Respect the person's stated availability. Answer only with the requested JSON.`;

/**
 * Ask the AI to improve titles, milestones and first-week tasks of a rule-generated plan.
 * Dates, values and hierarchy always come from the deterministic plan; every AI field is verified
 * (known keys, dates inside the first week, sane durations) and anything invalid is dropped.
 * If AI is unavailable or fails, the rule-based plan is returned with a note.
 */
export async function refinePlanWithAi(
  input: BreakdownRequest,
  base: DraftPlan,
  prefs: Preferences,
  today: string,
): Promise<{ plan: DraftPlan; source: "rules" | "ai"; notes: string[] }> {
  const ai = aiProvider();
  if (!ai) return { plan: base, source: "rules", notes: ["AI is not configured, so this plan uses GoalFlow's built-in rules."] };

  const weekGoal = base.tasks.length
    ? base.goals.find((g) => g.key === base.tasks[0]!.goalKey)
    : base.goals.find((g) => g.level === "week" && g.targetDate >= today);
  const window = weekGoal ? { from: weekGoal.startDate < today ? today : weekGoal.startDate, to: weekGoal.targetDate } : null;
  const prompt = JSON.stringify({
    goal: {
      title: input.title,
      outcome: input.outcome,
      category: input.category,
      measure: `${input.startValue} → ${input.targetValue} ${input.unit} (${input.direction})`,
      startDate: input.startDate,
      targetDate: input.targetDate,
      estimatedHours: input.estimatedHours,
      userMilestones: input.milestones,
    },
    availability: {
      workingDays: prefs.workingDays,
      hoursPerDay: prefs.availableHoursPerDay,
      sessionsPerWeek: input.sessionsPerWeek,
      sessionMinutes: input.sessionMinutes,
    },
    today,
    draftGoals: base.goals.filter((g) => g.level !== "year").map((g) => ({ key: g.key, level: g.level, start: g.startDate, end: g.targetDate, target: g.targetValue })),
    firstWeekWindow: window,
    instructions: [
      "Propose 3-6 measurable milestones for the yearly goal with weights summing to about 100 (keep any userMilestones).",
      "For each draft goal key, propose a clearer title that states the concrete target for that period. Use only keys provided.",
      `Propose up to ${Math.min(14, Math.max(1, input.sessionsPerWeek))} specific daily actions for firstWeekWindow, dated within it, each ${input.sessionMinutes} minutes or less.`,
      "Add short notes about risks or workload concerns (max 4).",
    ],
  });

  let out: z.infer<typeof PlanSuggestion>;
  try {
    out = await ai.generate({ system: SYSTEM, prompt, schema: PlanSuggestion, maxTokens: 8000 });
  } catch (err) {
    console.warn("[ai] plan refinement failed:", (err as Error).message);
    return { plan: base, source: "rules", notes: ["The AI could not be reached, so this plan uses GoalFlow's built-in rules."] };
  }

  const keys = new Set(base.goals.map((g) => g.key));
  const titleByKey = new Map(
    out.goalTitles.filter((t) => keys.has(t.key) && t.key !== "root" && t.title.trim()).map((t) => [t.key, t.title.trim().slice(0, 200)]),
  );
  const goals = base.goals.map((g) => (titleByKey.has(g.key) ? { ...g, title: titleByKey.get(g.key)! } : g));
  const milestones = out.milestones
    .filter((m) => m.title.trim() && m.weight > 0 && m.weight <= 1000)
    .slice(0, 10)
    .map((m) => ({ title: m.title.trim().slice(0, 200), weight: Math.round(m.weight) }));
  const dropped: string[] = [];
  const tasks =
    window && weekGoal
      ? out.tasks
          .filter((t) => {
            const ok = /^\d{4}-\d{2}-\d{2}$/.test(t.date) && t.date >= window.from && t.date <= window.to && t.estimatedMinutes >= 5 && t.estimatedMinutes <= 480 && t.title.trim();
            if (!ok) dropped.push(t.title);
            return ok;
          })
          .slice(0, 14)
          .map((t, i) => ({
            key: `ai${i}`,
            goalKey: weekGoal.key,
            title: t.title.trim().slice(0, 200),
            date: t.date,
            estimatedMinutes: Math.round(t.estimatedMinutes),
            priority: t.priority,
          }))
      : base.tasks;
  const notes = out.notes.slice(0, 4).map((n) => n.slice(0, 300));
  if (dropped.length) notes.push(`${dropped.length} suggested task(s) were dropped because their dates or durations were invalid.`);
  return {
    plan: { ...base, goals, milestones: milestones.length ? milestones : base.milestones, tasks: tasks.length ? tasks : base.tasks },
    source: "ai",
    notes,
  };
}
