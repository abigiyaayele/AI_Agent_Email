import { and, asc, eq, inArray, isNull, lt } from "drizzle-orm";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Stat } from "@/components/ui";
import { DayTimeline, type TimelineItem } from "@/components/planner/timeline";
import { Rebalance } from "@/components/planner/rebalance";
import { QuickAdd, TaskListView } from "@/components/tasks/task-list";
import { CarryAllButton } from "@/components/planner/carry-all";
import { addDays, dayBounds, nowIn, todayIn } from "@/lib/domain/periods";
import { commitmentsOn, dailyCapacityMinutes, overlappingPairs, plannedMinutes } from "@/lib/domain/scheduling";
import { formatMinutes } from "@/lib/domain/timer";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { listSchedules } from "@/server/services/account";
import { goalOptions, toTaskItem } from "@/server/services/task-view";
import { materializeRecurring, sortByPriority, tasksInRange, toLoadTask } from "@/server/services/tasks";

export const metadata = { title: "My Day" };

export default async function TodayPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const today = todayIn(tz);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const { start, end } = dayBounds(date, tz);
  await materializeRecurring(user.id, start, dayBounds(addDays(date, 14), tz).end);
  const now = new Date();

  const [rows, overdueRows, backlogRows, commitments, goals] = await Promise.all([
    tasksInRange(user.id, start, end),
    db()
      .select({ task: s.tasks, goalTitle: s.goals.title })
      .from(s.tasks)
      .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
      .where(and(eq(s.tasks.userId, user.id), inArray(s.tasks.status, ["todo", "in_progress", "blocked"]), lt(s.tasks.dueAt, start)))
      .orderBy(asc(s.tasks.dueAt))
      .limit(50),
    db()
      .select({ task: s.tasks, goalTitle: s.goals.title })
      .from(s.tasks)
      .leftJoin(s.goals, eq(s.goals.id, s.tasks.goalId))
      .where(and(eq(s.tasks.userId, user.id), inArray(s.tasks.status, ["todo", "in_progress", "blocked"]), isNull(s.tasks.scheduledStart), isNull(s.tasks.dueAt)))
      .orderBy(asc(s.tasks.createdAt))
      .limit(15),
    listSchedules(user.id),
    goalOptions(user.id),
  ]);

  const open = rows.filter((r) => r.task.status !== "done" && r.task.status !== "deferred");
  const done = rows.filter((r) => r.task.status === "done");
  const top3 = sortByPriority([...open, ...overdueRows].map((r) => ({ ...r, priority: r.task.priority, scheduledStart: r.task.scheduledStart, dueAt: r.task.dueAt }))).slice(0, 3);
  const scheduled = rows.filter((r) => r.task.scheduledStart && r.task.scheduledEnd);
  const unscheduledToday = open.filter((r) => !r.task.scheduledStart);
  const commitmentItems = commitmentsOn(date, tz, commitments);
  const timeline: TimelineItem[] = [
    ...scheduled.map((r) => ({
      id: r.task.id,
      label: r.task.title,
      start: r.task.scheduledStart!,
      end: r.task.scheduledEnd!,
      kind: "task" as const,
      status: r.task.status,
      href: `/tasks/${r.task.id}`,
    })),
    ...commitmentItems.map((c) => ({ ...c, kind: "commitment" as const })),
  ];
  const conflictIds = new Set(
    overlappingPairs(timeline.filter((t) => t.status !== "done")).flatMap(([a, b]) => [a.id, b.id]),
  );
  timeline.forEach((t) => (t.conflict = conflictIds.has(t.id)));

  const planned = open.reduce((sum, r) => sum + plannedMinutes(toLoadTask(r.task)), 0);
  const capacity = dailyCapacityMinutes(date, prefs);
  const actual = rows.reduce((sum, r) => sum + r.task.actualMinutes, 0);
  const tomorrow = addDays(date, 1);
  const hour = nowIn(tz).hour;
  const [ph] = prefs.preferredStart.split(":").map(Number);
  const [eh] = prefs.preferredEnd.split(":").map(Number);

  return (
    <div className="space-y-5">
      <PageHeader
        title={date === today ? "My Day" : `Plan for ${date}`}
        subtitle={nowIn(tz, start).toFormat("cccc, d LLLL yyyy")}
        actions={
          <>
            <LinkButton size="sm" href={`/today?date=${addDays(date, -1)}`}>
              ← Previous
            </LinkButton>
            {date !== today ? (
              <LinkButton size="sm" href="/today">
                Today
              </LinkButton>
            ) : null}
            <LinkButton size="sm" href={`/today?date=${tomorrow}`}>
              Next →
            </LinkButton>
            <LinkButton size="sm" variant="primary" href={`/plan/day?date=${date}`}>
              End-of-day review
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Planned" value={formatMinutes(planned)} hint={`capacity ${formatMinutes(capacity)}`} />
        <Stat label="Recorded" value={formatMinutes(actual)} />
        <Stat label="Done" value={`${done.length} / ${rows.length}`} />
        <Stat label="Overdue" value={overdueRows.length} />
      </div>

      {planned > capacity ? (
        <Card className="border-danger/50 bg-danger-soft/40">
          <p className="font-medium text-danger">
            {capacity === 0 ? "This is not a working day in your settings, but work is planned." : `Over capacity by ${formatMinutes(planned - capacity)}.`}
          </p>
          <p className="mb-3 text-sm text-muted">GoalFlow can propose moving lower-priority work to days with room. You approve each move.</p>
          <Rebalance from={date} to={addDays(date, 13)} />
        </Card>
      ) : null}

      <Card>
        <QuickAdd date={date} goals={goals} />
      </Card>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <CardHeader title="Top three priorities" subtitle="The most important open work for today." />
            {top3.length ? (
              <TaskListView items={top3.map((r) => toTaskItem(r, tz, now))} tomorrow={tomorrow} />
            ) : (
              <EmptyState title="Nothing planned yet">Add tasks above or pull from your backlog.</EmptyState>
            )}
          </Card>
          <Card>
            <CardHeader
              title="Today's tasks"
              subtitle={`${open.length} open · ${done.length} done`}
              action={open.length ? <CarryAllButton ids={open.map((r) => r.task.id)} to={tomorrow} /> : null}
            />
            <TaskListView items={open.map((r) => toTaskItem(r, tz, now))} tomorrow={tomorrow} empty={<p className="py-2 text-sm text-muted">No open tasks today.</p>} />
            {unscheduledToday.length ? <p className="mt-2 text-xs text-muted">{unscheduledToday.length} of these have no start time; drag them onto the calendar to schedule.</p> : null}
          </Card>
          {overdueRows.length ? (
            <Card className="border-danger/40">
              <CardHeader title="Overdue" action={<CarryAllButton ids={overdueRows.map((r) => r.task.id)} to={date} label="Plan all for this day" />} />
              <TaskListView items={overdueRows.map((r) => toTaskItem(r, tz, now))} tomorrow={tomorrow} />
            </Card>
          ) : null}
          <Card>
            <CardHeader title="Completed" />
            <TaskListView items={done.map((r) => toTaskItem(r, tz, now))} empty={<p className="py-2 text-sm text-muted">Nothing completed yet{hour < 12 ? " — the day is young" : ""}.</p>} />
          </Card>
          <Card>
            <CardHeader title="Unscheduled backlog" subtitle="Tasks without a date." />
            <TaskListView items={backlogRows.map((r) => toTaskItem(r, tz, now))} tomorrow={date} />
          </Card>
        </div>
        <Card className="lg:col-span-2">
          <CardHeader title="Timeline" subtitle={conflictIds.size ? `${conflictIds.size} items overlap` : "Scheduled tasks and commitments"} />
          <DayTimeline items={timeline} dayStart={start} tz={tz} fromHour={Math.max(0, (ph ?? 9) - 1)} toHour={Math.min(24, (eh ?? 17) + 2)} />
        </Card>
      </div>
    </div>
  );
}
