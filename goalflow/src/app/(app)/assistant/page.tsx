import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, ProgressBar } from "@/components/ui";
import { AiPanel } from "@/components/assistant/ai-panel";
import { Rebalance } from "@/components/planner/rebalance";
import { StartTimerButton } from "@/components/timer/start-timer-button";
import { features } from "@/lib/env";
import { addDays, todayIn } from "@/lib/domain/periods";
import { formatMinutes } from "@/lib/domain/timer";
import { requireAuth } from "@/server/auth/session";
import { assistantBrief } from "@/server/services/assistant";

export const metadata = { title: "AI Assistant" };

export default async function AssistantPage() {
  const { user, prefs } = await requireAuth();
  const b = await assistantBrief(user.id, prefs);
  const today = todayIn(prefs.timezone);
  const overloaded = b.loads.some((l) => l.overload > 0);

  return (
    <div className="space-y-5">
      <PageHeader title="Assistant" subtitle="Suggestions from your own goals, tasks and time. Nothing changes until you approve it." />

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="What to do next" />
          {b.next ? (
            <div>
              <Link href={`/tasks/${b.next.id}`} className="text-lg font-medium hover:underline">
                {b.next.title}
              </Link>
              <p className="mt-1 text-sm text-muted">Because {b.next.reasons.join(", ")}.</p>
              <div className="mt-3 flex gap-2">
                <StartTimerButton taskId={b.next.id} withLabel />
                <LinkButton size="sm" href={`/tasks/${b.next.id}`}>
                  Open <ArrowRight size={14} />
                </LinkButton>
              </div>
            </div>
          ) : (
            <EmptyState title="No open tasks">Add tasks or break down a goal to get suggestions.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Risks" subtitle={b.risks.length ? undefined : "Nothing needs attention right now."} />
          {b.risks.length ? (
            <ul className="space-y-2 text-sm">
              {b.risks.map((r, i) => (
                <li key={i} className="flex items-start gap-2">
                  <AlertTriangle size={14} className={r.level === "high" ? "mt-0.5 shrink-0 text-danger" : "mt-0.5 shrink-0 text-warn"} aria-hidden />
                  <span className="flex-1">
                    <Badge tone={r.level === "high" ? "danger" : "warn"} className="mr-1">
                      {r.level}
                    </Badge>
                    {r.href ? (
                      <Link href={r.href} className="hover:underline">
                        {r.text}
                      </Link>
                    ) : (
                      r.text
                    )}
                  </span>
                </li>
              ))}
            </ul>
          ) : null}
        </Card>
      </div>

      <Card>
        <CardHeader title="Recovery plan" subtitle="Moves lower-priority work from overloaded days to days with room. Critical tasks and deadlines are never moved." />
        {overloaded ? <Rebalance from={today} to={addDays(today, 13)} /> : <p className="text-sm text-muted">Your next two weeks fit your available hours ({formatMinutes(b.capacityToday)} available today).</p>}
      </Card>

      <Card>
        <CardHeader title="How your tasks move your goals" subtitle="Goals furthest behind first. Share is each task's part of the goal's remaining planned effort." />
        {b.contributions.length ? (
          <div className="grid gap-5 md:grid-cols-2">
            {b.contributions.map((c) => (
              <div key={c.goalId}>
                <div className="mb-1 flex justify-between gap-2 text-sm">
                  <Link href={`/goals/${c.goalId}`} className="truncate font-medium hover:underline">
                    {c.goalTitle}
                  </Link>
                  <span className="shrink-0 text-muted tabular-nums">
                    {c.pct}% (expected {c.expected}%)
                  </span>
                </div>
                <ProgressBar value={c.pct} expected={c.expected} label={`${c.goalTitle} progress`} />
                <ul className="mt-2 space-y-1 text-sm">
                  {c.tasks.map((t) => (
                    <li key={t.id} className="flex justify-between gap-2">
                      <Link href={`/tasks/${t.id}`} className="truncate hover:underline">
                        {t.title}
                      </Link>
                      <span className="shrink-0 text-xs text-muted tabular-nums">
                        {formatMinutes(t.minutes)} · {t.sharePct}%
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted">Link tasks to goals to see how each one contributes.</p>
        )}
      </Card>

      <Card>
        <CardHeader title="AI planning help" subtitle="Optional. Uses only your own data; every suggestion is checked and needs your approval." />
        <AiPanel enabled={features().ai} />
      </Card>
    </div>
  );
}
