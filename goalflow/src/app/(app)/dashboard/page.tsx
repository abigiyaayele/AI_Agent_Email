import Link from "next/link";
import { and, asc, eq, gte, inArray, lt } from "drizzle-orm";
import { AlertTriangle, CalendarClock } from "lucide-react";
import { Badge, Card, CardHeader, EmptyState, LinkButton, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { PaceBadge } from "@/components/goals/goal-bits";
import { DayTimeline, type TimelineItem } from "@/components/planner/timeline";
import { QuickAdd, TaskListView } from "@/components/tasks/task-list";
import { addDays, dayBounds, eachDate, formatDate, formatInstant, nowIn, periodContaining, todayIn } from "@/lib/domain/periods";
import { commitmentsOn, dailyCapacityMinutes, overlappingPairs, plannedMinutes } from "@/lib/domain/scheduling";
import { formatMinutes } from "@/lib/domain/timer";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { listSchedules } from "@/server/services/account";
import { loadGoalForest } from "@/server/services/goals";
import { goalOptions, toTaskItem } from "@/server/services/task-view";
import { materializeRecurring, sortByPriority, tasksInRange, toLoadTask } from "@/server/services/tasks";
import { buildTimesheet } from "@/server/services/timesheet";

export const metadata = { title: "Dashboard" };

const OPEN = ["todo", "in_progress", "blocked"] as const;

export default async function DashboardPage() {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const now = new Date();
  const local = nowIn(tz, now);
  const today = todayIn(tz, now);
  const { start, end } = dayBounds(today, tz);
  const week = periodContaining("week", today, tz, prefs.weekStartsOn);
  await materializeRecurring(user.id, start, dayBounds(addDays(today, 7), tz).end);

  const [rows, overdue, upcoming, forest, schedules, goals, sheet] = await Promise.all([
    tasksInRange(user.id, start, end),
    db()
      .select({ task: s.tasks, goalTitle: s.goals.title })
      .from(s.tasks)
      .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
      .where(and(eq(s.tasks.userId, user.id), inArray(s.tasks.status, [...OPEN]), lt(s.tasks.dueAt, start)))
      .orderBy(asc(s.tasks.dueAt))
      .limit(10),
    db()
      .select({ task: s.tasks, goalTitle: s.goals.title })
      .from(s.tasks)
      .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
      .where(and(eq(s.tasks.userId, user.id), inArray(s.tasks.status, [...OPEN]), gte(s.tasks.dueAt, end), lt(s.tasks.dueAt, dayBounds(addDays(today, 7), tz).end)))
      .orderBy(asc(s.tasks.dueAt))
      .limit(8),
    loadGoalForest(user.id, today),
    listSchedules(user.id),
    goalOptions(user.id),
    buildTimesheet(user.id, tz, eachDate(week.start, week.end), now),
  ]);

  const open = rows.filter((r) => r.task.status !== "done" && r.task.status !== "deferred");
  const done = rows.filter((r) => r.task.status === "done");
  const top3 = sortByPriority([...open, ...overdue].map((r) => ({ ...r, priority: r.task.priority, scheduledStart: r.task.scheduledStart, dueAt: r.task.dueAt }))).slice(0, 3);
  const planned = open.reduce((sum, r) => sum + plannedMinutes(toLoadTask(r.task)), 0);
  const capacity = dailyCapacityMinutes(today, prefs);
  const focusToday = sheet.days.find((d) => d.key === today)?.focus ?? 0;

  const timeline: TimelineItem[] = [
    ...rows
      .filter((r) => r.task.scheduledStart && r.task.scheduledEnd)
      .map((r) => ({ id: r.task.id, label: r.task.title, start: r.task.scheduledStart!, end: r.task.scheduledEnd!, kind: "task" as const, status: r.task.status, href: `/tasks/${r.task.id}` })),
    ...commitmentsOn(today, tz, schedules).map((c) => ({ ...c, kind: "commitment" as const })),
  ];
  const conflicts = new Set(overlappingPairs(timeline.filter((t) => t.status !== "done")).flatMap(([a, b]) => [a.id, b.id]));
  timeline.forEach((t) => (t.conflict = conflicts.has(t.id)));

  const active = forest.goals.filter((g) => g.status === "active" || g.status === "not_started");
  const current = (level: s.Goal["level"]) => active.filter((g) => g.level === level && g.startDate <= today && g.targetDate >= today);
  const horizonCards = [
    { level: "week" as const, title: "This week", href: "/plan/week" },
    { level: "month" as const, title: "This month", href: "/plan/month" },
    { level: "year" as const, title: "This year", href: "/plan/year" },
  ].map((h) => ({ ...h, goals: current(h.level) }));
  const goalDeadlines = active.filter((g) => g.targetDate >= today && g.targetDate <= addDays(today, 30) && g.progress.pct < 100).slice(0, 5);
  const behind = active.filter((g) => g.pace === "behind" || g.pace === "at_risk" || g.pace === "overdue").length;
  const [ph] = prefs.preferredStart.split(":").map(Number);
  const [eh] = prefs.preferredEnd.split(":").map(Number);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`Good ${local.hour < 12 ? "morning" : local.hour < 18 ? "afternoon" : "evening"}, ${user.name.split(" ")[0]}`}
        subtitle={local.toFormat("cccc, d LLLL yyyy")}
        actions={
          <>
            <LinkButton size="sm" href="/today">
              Plan my day
            </LinkButton>
            <LinkButton size="sm" variant="primary" href="/plan/day">
              Daily summary
            </LinkButton>
          </>
        }
      />
      {!prefs.onboarded ? (
        <Card>
          <p className="font-medium">Finish setting up</p>
          <p className="mt-1 text-sm text-muted">Confirm your working hours so GoalFlow can calculate realistic plans.</p>
          <LinkButton className="mt-3" variant="primary" href="/settings">
            Open settings
          </LinkButton>
        </Card>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Today" value={`${done.length} / ${rows.length} done`} hint={`${formatMinutes(planned)} planned of ${formatMinutes(capacity)} available`} />
        <Stat label="Focus today" value={formatMinutes(focusToday)} hint={`${formatMinutes(sheet.focus)} this week`} />
        <Stat label="Overdue" value={overdue.length} hint={overdue.length ? "needs a new date" : "nothing late"} />
        <Stat label="Goals behind pace" value={behind} hint={`${active.length} active goals`} />
      </div>

      <Card>
        <QuickAdd date={today} goals={goals} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <CardHeader title="Top three priorities" action={<Link href="/today" className="text-sm text-muted hover:underline">My Day →</Link>} />
            {top3.length ? <TaskListView items={top3.map((r) => toTaskItem(r, tz, now))} tomorrow={addDays(today, 1)} /> : <EmptyState title="Nothing planned for today">Use quick add above, or pull work from your backlog in My Day.</EmptyState>}
            {planned > capacity ? (
              <p className="mt-3 flex items-center gap-1.5 text-sm text-danger">
                <AlertTriangle size={14} /> Today is over capacity by {formatMinutes(planned - capacity)}. <Link href="/today" className="underline">Rebalance</Link>
              </p>
            ) : null}
          </Card>

          <div className="grid gap-5 md:grid-cols-3">
            {horizonCards.map((h) => (
              <Card key={h.level}>
                <CardHeader title={h.title} action={<Link href={h.href} className="text-xs text-muted hover:underline">Review</Link>} />
                {h.goals.length ? (
                  <ul className="space-y-3">
                    {h.goals.slice(0, 4).map((g) => (
                      <li key={g.id}>
                        <div className="mb-1 flex items-center justify-between gap-2 text-sm">
                          <Link href={`/goals/${g.id}`} className="truncate hover:underline">
                            {g.title}
                          </Link>
                          <span className="shrink-0 tabular-nums">{Math.round(g.progress.pct)}%</span>
                        </div>
                        <ProgressBar value={g.progress.pct} expected={g.expected} label={`${g.title} progress`} />
                        <div className="mt-1">
                          <PaceBadge pace={g.pace} />
                        </div>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-sm text-muted">
                    No {h.level}ly goal. <Link href="/goals/plan" className="underline">Break one down</Link>
                  </p>
                )}
              </Card>
            ))}
          </div>

          <div className="grid gap-5 md:grid-cols-2">
            <Card className={overdue.length ? "border-danger/40" : undefined}>
              <CardHeader title="Overdue" />
              <TaskListView items={overdue.map((r) => toTaskItem(r, tz, now))} tomorrow={today} empty={<p className="text-sm text-muted">Nothing overdue.</p>} />
            </Card>
            <Card>
              <CardHeader title="Upcoming deadlines" subtitle="Next 7 days" />
              {upcoming.length || goalDeadlines.length ? (
                <ul className="space-y-2 text-sm">
                  {upcoming.map((r) => (
                    <li key={r.task.id} className="flex items-center gap-2">
                      <CalendarClock size={14} className="shrink-0 text-muted" />
                      <Link href={`/tasks/${r.task.id}`} className="flex-1 truncate hover:underline">
                        {r.task.title}
                      </Link>
                      <span className="text-xs text-muted">{formatInstant(r.task.dueAt, tz, "EEE d LLL")}</span>
                    </li>
                  ))}
                  {goalDeadlines.map((g) => (
                    <li key={g.id} className="flex items-center gap-2">
                      <Badge tone="info">goal</Badge>
                      <Link href={`/goals/${g.id}`} className="flex-1 truncate hover:underline">
                        {g.title}
                      </Link>
                      <span className="text-xs text-muted">{formatDate(g.targetDate, "d LLL")}</span>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="text-sm text-muted">No deadlines in the next week.</p>
              )}
            </Card>
          </div>
        </div>

        <Card className="lg:col-span-2">
          <CardHeader title="Today's timeline" subtitle={conflicts.size ? `${conflicts.size} items overlap` : undefined} action={<Link href="/calendar" className="text-sm text-muted hover:underline">Calendar →</Link>} />
          <DayTimeline items={timeline} dayStart={start} tz={tz} fromHour={Math.max(0, (ph ?? 9) - 1)} toHour={Math.min(24, (eh ?? 17) + 2)} />
        </Card>
      </div>
    </div>
  );
}
