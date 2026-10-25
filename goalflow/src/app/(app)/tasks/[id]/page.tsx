import Link from "next/link";
import { notFound } from "next/navigation";
import { and, eq, ne } from "drizzle-orm";
import { Badge, Card, CardHeader, PageHeader, Stat } from "@/components/ui";
import { TaskForm } from "@/components/tasks/task-form";
import { NewTaskButton, PriorityBadge, TaskListView } from "@/components/tasks/task-list";
import { Checklist, DeleteTask, Dependencies, SessionEditor, SessionList } from "@/components/tasks/task-detail-client";
import { StartTimerButton } from "@/components/timer/start-timer-button";
import { TASK_STATUS_LABEL } from "@/lib/constants";
import { remainingMinutes } from "@/lib/domain/estimation";
import { formatInstant } from "@/lib/domain/periods";
import { describeRule } from "@/lib/domain/recurrence";
import { toLocalInputValue } from "@/lib/domain/tasks";
import { formatMinutes } from "@/lib/domain/timer";
import { requireAuth } from "@/server/auth/session";
import { updateTaskAction } from "@/server/actions/tasks";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { goalOptions, toSessionRow, toTaskItem } from "@/server/services/task-view";
import { getTask } from "@/server/services/tasks";

export const metadata = { title: "Task" };

function describeHistory(action: string, data: Record<string, unknown>) {
  switch (action) {
    case "task.created":
      return "Created";
    case "task.status":
      return `Status ${String(data.from).replace("_", " ")} → ${String(data.to).replace("_", " ")}`;
    case "task.rescheduled":
      return "Rescheduled";
    case "task.carried_over":
      return `Carried over to ${String(data.toDate)}`;
    case "task.updated":
      return `Edited ${Object.keys(data).join(", ")}`;
    default:
      return action;
  }
}

export default async function TaskPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const d = await getTask(user.id, id);
  if (!d) notFound();
  const t = d.task;
  const [goals, candidates] = await Promise.all([
    goalOptions(user.id),
    db()
      .select({ id: s.tasks.id, title: s.tasks.title })
      .from(s.tasks)
      .where(and(eq(s.tasks.userId, user.id), ne(s.tasks.id, id), ne(s.tasks.status, "done")))
      .limit(300),
  ]);
  const startRem = d.reminders.find((r) => r.kind === "task_start");
  const dueRem = d.reminders.find((r) => r.kind === "deadline");
  const durationMin = t.scheduledStart && t.scheduledEnd ? Math.round((t.scheduledEnd.getTime() - t.scheduledStart.getTime()) / 60000) : null;
  const focusMin = d.sessions.filter((w) => w.kind === "focus" && w.endedAt).reduce((sum, w) => sum + toSessionRow(w, tz).minutes, 0);
  const breakMin = d.sessions.filter((w) => w.kind === "break" && w.endedAt).reduce((sum, w) => sum + toSessionRow(w, tz).minutes, 0);

  return (
    <div className="space-y-5">
      <PageHeader
        title={t.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <Badge tone={t.status === "done" ? "ok" : t.status === "blocked" ? "danger" : "neutral"}>{TASK_STATUS_LABEL[t.status]}</Badge>
            <PriorityBadge p={t.priority} />
            {d.goal ? (
              <Link href={`/goals/${d.goal.id}`} className="hover:underline">
                Goal: {d.goal.title}
              </Link>
            ) : (
              <Badge tone="warn">Not linked to a goal</Badge>
            )}
            {d.parent ? (
              <Link href={`/tasks/${d.parent.id}`} className="hover:underline">
                Subtask of {d.parent.title}
              </Link>
            ) : null}
            {d.rule ? <Badge tone="info">{describeRule(d.rule)}</Badge> : null}
            {t.carryOverCount ? <Badge>carried over {t.carryOverCount}×</Badge> : null}
          </span>
        }
        actions={
          <>
            {t.status !== "done" ? <StartTimerButton taskId={t.id} withLabel /> : null}
            <DeleteTask id={t.id} title={t.title} />
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
        <Stat label="Estimated" value={formatMinutes(t.estimatedMinutes)} />
        <Stat label="Actual (focus)" value={formatMinutes(focusMin)} hint={breakMin ? `${formatMinutes(breakMin)} breaks` : undefined} />
        <Stat label="Remaining" value={formatMinutes(remainingMinutes(t))} />
        <Stat label="Scheduled" value={t.scheduledStart ? formatInstant(t.scheduledStart, tz, "EEE d LLL HH:mm") : "–"} />
        <Stat label="Deadline" value={t.dueAt ? formatInstant(t.dueAt, tz, "EEE d LLL HH:mm") : "–"} />
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Details" />
          <TaskForm
            action={updateTaskAction.bind(null, t.id)}
            goals={goals}
            submitLabel="Save task"
            defaults={{
              title: t.title,
              description: t.description,
              notes: t.notes,
              status: t.status,
              priority: t.priority,
              goalId: t.goalId ?? "",
              milestoneId: t.milestoneId ?? "",
              parentTaskId: t.parentTaskId ?? "",
              scheduledStart: toLocalInputValue(t.scheduledStart, tz),
              durationMinutes: durationMin ? String(durationMin) : "",
              dueAt: toLocalInputValue(t.dueAt, tz),
              estimatedMinutes: t.estimatedMinutes ? String(t.estimatedMinutes) : "",
              remainingMinutes: t.remainingMinutes !== null ? String(t.remainingMinutes) : "",
              allowOverlap: t.allowOverlap,
              startReminder: startRem?.offsetMinutes !== null && startRem?.offsetMinutes !== undefined ? String(startRem.offsetMinutes) : "none",
              deadlineReminder: dueRem?.offsetMinutes !== null && dueRem?.offsetMinutes !== undefined ? String(dueRem.offsetMinutes) : "none",
              recurrenceFreq: d.rule?.freq ?? "none",
              recurrenceInterval: String(d.rule?.interval ?? 1),
              recurrenceDays: d.rule?.byWeekday ?? [],
              recurrenceUntil: d.rule?.untilDate ?? "",
            }}
          />
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="Checklist" />
            <Checklist taskId={t.id} items={d.checklist.map((c) => ({ id: c.id, title: c.title, done: c.done }))} />
          </Card>
          <Card>
            <CardHeader
              title="Subtasks"
              action={<NewTaskButton goals={goals} label="Subtask" defaults={{ parentTaskId: t.id, goalId: t.goalId ?? "", milestoneId: t.milestoneId ?? "" }} />}
            />
            <TaskListView items={d.subtasks.map((st) => toTaskItem({ task: st, goalTitle: d.goal?.title ?? null }, tz))} />
          </Card>
          <Card>
            <CardHeader title="Blocked by" />
            <Dependencies taskId={t.id} deps={d.deps} candidates={candidates} />
          </Card>
        </div>
      </div>

      <Card>
        <CardHeader title="Work sessions" subtitle="Timer sessions, manual entries and corrections." />
        <SessionList rows={d.sessions.map((w) => toSessionRow(w, tz))} />
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">Add time manually</summary>
          <div className="mt-3">
            <SessionEditor taskId={t.id} />
          </div>
        </details>
      </Card>

      <Card>
        <CardHeader title="History" />
        {d.history.length ? (
          <ul className="space-y-1 text-sm">
            {d.history.map((h) => (
              <li key={h.id} className="flex gap-3">
                <span className="w-32 shrink-0 text-xs text-muted tabular-nums">{formatInstant(h.createdAt, tz, "d LLL HH:mm")}</span>
                <span>{describeHistory(h.action, h.data)}</span>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">No history yet.</p>
        )}
      </Card>
    </div>
  );
}
