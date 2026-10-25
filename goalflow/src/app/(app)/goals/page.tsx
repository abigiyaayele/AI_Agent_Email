import Link from "next/link";
import { Plus, Wand2 } from "lucide-react";
import { GoalTree } from "@/components/goals/goal-bits";
import { Card, EmptyState, LinkButton, PageHeader, Stat, cn } from "@/components/ui";
import { GOAL_CATEGORIES } from "@/lib/constants";
import { todayIn } from "@/lib/domain/periods";
import { titleCase } from "@/lib/format";
import { requireAuth } from "@/server/auth/session";
import { buildTree, loadGoalForest } from "@/server/services/goals";

export const metadata = { title: "Goal Hierarchy" };

export default async function GoalsPage({ searchParams }: { searchParams: Promise<{ category?: string; show?: string }> }) {
  const { user, prefs } = await requireAuth();
  const sp = await searchParams;
  const { goals } = await loadGoalForest(user.id, todayIn(prefs.timezone));
  const show = sp.show ?? "open";
  const visible = goals.filter(
    (g) =>
      (!sp.category || g.category === sp.category) &&
      (show === "all" || (show === "open" ? g.status === "active" || g.status === "not_started" || g.status === "on_hold" : g.status === show)),
  );
  // Keep ancestors of matching goals so the tree stays connected.
  const ids = new Set(visible.map((g) => g.id));
  const byId = new Map(goals.map((g) => [g.id, g]));
  for (const g of visible) {
    for (let p = g.parentId ? byId.get(g.parentId) : undefined; p; p = p.parentId ? byId.get(p.parentId) : undefined) ids.add(p.id);
  }
  const tree = buildTree(goals.filter((g) => ids.has(g.id)));
  const yearly = goals.filter((g) => g.level === "year" && g.status !== "abandoned");
  const atRisk = goals.filter((g) => g.pace === "at_risk" || g.pace === "behind").length;
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams({ ...(sp.category ? { category: sp.category } : {}), show, ...patch } as Record<string, string>);
    for (const [k, v] of [...p.entries()]) if (!v) p.delete(k);
    return `/goals?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Goal Hierarchy"
        subtitle="Yearly goals → six-month → quarterly → monthly → weekly targets → daily tasks."
        actions={
          <>
            <LinkButton href="/goals/plan" variant="primary">
              <Wand2 size={16} /> Plan a yearly goal
            </LinkButton>
            <LinkButton href="/goals/new">
              <Plus size={16} /> New goal
            </LinkButton>
          </>
        }
      />
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Yearly goals" value={yearly.length} />
        <Stat label="All goals" value={goals.length} />
        <Stat
          label="Average yearly progress"
          value={yearly.length ? `${Math.round(yearly.reduce((s, g) => s + g.progress.pct, 0) / yearly.length)}%` : "–"}
        />
        <Stat label="Behind or at risk" value={atRisk} />
      </div>
      <Card>
        <div className="mb-3 flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Filter goals">
          {[
            ["open", "Open"],
            ["completed", "Completed"],
            ["all", "All"],
          ].map(([v, l]) => (
            <Link key={v} href={q({ show: v })} className={cn("rounded-lg border px-2.5 py-1", show === v ? "border-accent bg-accent-soft text-accent" : "border-border")}>
              {l}
            </Link>
          ))}
          <span className="mx-1 self-center text-muted">|</span>
          <Link href={q({ category: undefined })} className={cn("rounded-lg border px-2.5 py-1", !sp.category ? "border-accent bg-accent-soft text-accent" : "border-border")}>
            All categories
          </Link>
          {GOAL_CATEGORIES.filter((c) => goals.some((g) => g.category === c)).map((c) => (
            <Link key={c} href={q({ category: c })} className={cn("rounded-lg border px-2.5 py-1", sp.category === c ? "border-accent bg-accent-soft text-accent" : "border-border")}>
              {titleCase(c)}
            </Link>
          ))}
        </div>
        {tree.length ? (
          <GoalTree nodes={tree} />
        ) : (
          <EmptyState
            title={goals.length ? "No goals match these filters" : "No goals yet"}
            action={
              <LinkButton href="/goals/plan" variant="primary">
                Plan your first yearly goal
              </LinkButton>
            }
          >
            The guided planner breaks a yearly goal into milestones, monthly and weekly targets, and first actions you review before saving.
          </EmptyState>
        )}
        <p className="mt-4 text-xs text-muted">The thin line on each bar marks where a linear plan would expect you to be today.</p>
      </Card>
    </div>
  );
}
