import { GoalForm } from "@/components/goals/goal-form";
import { Card, PageHeader } from "@/components/ui";
import { GOAL_LEVELS, type GoalLevel } from "@/lib/constants";
import { nextLevel } from "@/lib/domain/hierarchy";
import { periodContaining, todayIn } from "@/lib/domain/periods";
import { requireAuth } from "@/server/auth/session";
import { createGoalAction } from "@/server/actions/goals";
import { loadGoalForest } from "@/server/services/goals";

export const metadata = { title: "New goal" };

const PERIOD_FOR: Record<GoalLevel, "year" | "half" | "quarter" | "month" | "week"> = {
  year: "year",
  half: "half",
  quarter: "quarter",
  month: "month",
  week: "week",
};

export default async function NewGoalPage({ searchParams }: { searchParams: Promise<{ parent?: string; level?: string }> }) {
  const { user, prefs } = await requireAuth();
  const sp = await searchParams;
  const today = todayIn(prefs.timezone);
  const { goals } = await loadGoalForest(user.id, today);
  const parent = goals.find((g) => g.id === sp.parent);
  const level: GoalLevel =
    (GOAL_LEVELS as readonly string[]).includes(sp.level ?? "") ? (sp.level as GoalLevel) : parent ? (nextLevel(parent.level) ?? "week") : "year";
  const period = periodContaining(PERIOD_FOR[level], parent && today < parent.startDate ? parent.startDate : today, prefs.timezone, prefs.weekStartsOn);
  const start = parent && period.start < parent.startDate ? parent.startDate : period.start;
  const end = parent && period.end > parent.targetDate ? parent.targetDate : period.end;
  return (
    <div className="space-y-5">
      <PageHeader title="New goal" subtitle={parent ? `Under: ${parent.title}` : "Create a goal at any horizon. You can link it to a larger goal later."} />
      <Card>
        <GoalForm
          action={createGoalAction}
          submitLabel="Create goal"
          parents={goals.map((g) => ({ id: g.id, title: g.title, level: g.level, startDate: g.startDate, targetDate: g.targetDate }))}
          defaults={{
            title: "",
            description: "",
            level,
            parentId: parent?.id ?? null,
            category: parent?.category ?? "personal",
            startDate: start,
            targetDate: end,
            metricType: parent?.metricType === "numeric" ? "numeric" : "tasks",
            unit: parent?.unit ?? "",
            direction: parent?.direction ?? "increase",
            startValue: parent?.metricType === "numeric" ? parent.currentValue : 0,
            targetValue: null,
            currentValue: parent?.metricType === "numeric" ? parent.currentValue : 0,
            priority: "medium",
            status: "active",
            estimatedHours: null,
            weight: 1,
          }}
        />
      </Card>
    </div>
  );
}
