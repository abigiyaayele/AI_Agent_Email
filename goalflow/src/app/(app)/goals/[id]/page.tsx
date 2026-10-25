import Link from "next/link";
import { notFound } from "next/navigation";
import { ChevronRight, Plus } from "lucide-react";
import { GoalForm } from "@/components/goals/goal-form";
import { GoalSummaryRow, LevelBadge, PaceBadge } from "@/components/goals/goal-bits";
import { DeleteGoalButton, GoalStatusSelect, MilestoneList, ProgressChart } from "@/components/goals/goal-client";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, Input, LinkButton, PageHeader, ProgressBar, Stat } from "@/components/ui";
import { METRIC_TYPE_LABEL, TASK_STATUS_LABEL } from "@/lib/constants";
import { formatDate, formatInstant } from "@/lib/domain/periods";
import { formatMinutes } from "@/lib/domain/timer";
import { titleCase } from "@/lib/format";
import { requireAuth } from "@/server/auth/session";
import { addMilestoneAction, recordProgressAction, updateGoalAction } from "@/server/actions/goals";
import { getGoalDetail } from "@/server/services/goals";
import { descendantIds } from "@/lib/domain/hierarchy";

export const metadata = { title: "Goal" };

export default async function GoalPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { user, prefs } = await requireAuth();
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const d = await getGoalDetail(user.id, id, prefs);
  if (!d) notFound();
  const { goal: g } = d;
  const tz = prefs.timezone;
  const overCapacity = d.effort.requiredPerDay !== null && d.effort.requiredPerDay > d.effort.capacityPerDay;
  const excluded = [...descendantIds(d.allGoals, g.id)];
  const openTasks = d.tasks.filter((t) => t.status !== "done");
  const doneTasks = d.tasks.filter((t) => t.status === "done");

  return (
    <div className="space-y-5">
      {d.ancestors.length ? (
        <nav aria-label="Breadcrumb" className="flex flex-wrap items-center gap-1 text-sm text-muted">
          <Link href="/goals" className="hover:underline">
            Goals
          </Link>
          {d.ancestors.map((a) => (
            <span key={a.id} className="flex items-center gap-1">
              <ChevronRight size={14} aria-hidden />
              <Link href={`/goals/${a.id}`} className="hover:underline">
                {a.title}
              </Link>
            </span>
          ))}
        </nav>
      ) : null}
      <PageHeader
        title={g.title}
        subtitle={
          <span className="flex flex-wrap items-center gap-1.5">
            <LevelBadge level={g.level} />
            <PaceBadge pace={g.pace} />
            <Badge>{titleCase(g.category)}</Badge>
            <span>
              {formatDate(g.startDate)} – {formatDate(g.targetDate)}
            </span>
          </span>
        }
        actions={
          <>
            <GoalStatusSelect id={g.id} status={g.status} />
            {g.level !== "week" ? (
              <LinkButton size="sm" href={`/goals/new?parent=${g.id}`}>
                <Plus size={14} /> Child goal
              </LinkButton>
            ) : null}
            <LinkButton size="sm" href={`/tasks?new=1&goal=${g.id}`}>
              <Plus size={14} /> Task
            </LinkButton>
            <DeleteGoalButton id={g.id} title={g.title} childCount={d.children.length} />
          </>
        }
      />
      {g.description ? <p className="max-w-3xl text-sm whitespace-pre-wrap text-muted">{g.description}</p> : null}

      <div className="grid gap-5 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Progress" subtitle={METRIC_TYPE_LABEL[g.metricType]} />
          <div className="flex items-end gap-3">
            <p className="text-4xl font-semibold tabular-nums">{g.progress.pct}%</p>
            <p className="pb-1 text-sm text-muted">expected by today: {g.expected}%</p>
          </div>
          <div className="mt-2">
            <ProgressBar value={g.progress.pct} expected={g.expected} />
          </div>
          <p className="mt-2 text-sm">
            {g.progress.explanation} {g.progress.assumption ? <Badge tone="warn">includes assumptions</Badge> : null}
          </p>
          {d.quantity ? (
            <p className="mt-2 text-sm text-muted">
              Remaining: {d.quantity.remaining} {g.unit}. Required pace: {d.quantity.perMonth ?? "–"} {g.unit}/month ({d.quantity.perWeek ?? "–"}/week).
            </p>
          ) : null}
          {d.forecast ? (
            <p className="mt-1 text-sm text-muted">
              Forecast from your recorded history: target reached around{" "}
              <strong className="text-fg">{formatInstant(d.forecast.date, tz, "d LLL yyyy")}</strong>
              {d.forecast.date.toISOString().slice(0, 10) > g.targetDate ? <Badge tone="danger" className="ml-1">after target date</Badge> : null}
            </p>
          ) : g.metricType === "numeric" ? (
            <p className="mt-1 text-xs text-muted">A forecast appears once at least two progress records span a day or more.</p>
          ) : null}
          {g.metricType === "numeric" ? (
            <ActionForm action={recordProgressAction.bind(null, g.id)} resetOnSuccess className="mt-4 flex flex-wrap items-end gap-2 border-t border-border pt-4">
              <Field label={`Current value${g.unit ? ` (${g.unit})` : ""}`} htmlFor="value">
                <Input id="value" name="value" type="number" step="any" defaultValue={g.currentValue} className="w-36" />
                <FieldError name="value" />
              </Field>
              <Field label="Note (optional)" htmlFor="note" className="min-w-40 flex-1">
                <Input id="note" name="note" placeholder="What changed?" />
              </Field>
              <SubmitButton>Record progress</SubmitButton>
            </ActionForm>
          ) : null}
          <div className="mt-4 border-t border-border pt-4">
            <ProgressChart
              unit={g.unit}
              points={d.snapshots.map((x) => ({ at: formatInstant(x.capturedAt, tz, "d LLL"), pct: x.progressPct, value: x.value }))}
            />
          </div>
        </Card>

        <Card>
          <CardHeader title="Effort" subtitle="Planned vs actual" />
          <div className="grid grid-cols-2 gap-2">
            <Stat label="Estimated" value={g.estimatedHours ? `${g.estimatedHours}h` : "–"} />
            <Stat label="Recorded" value={formatMinutes(g.actualMinutes)} />
            <Stat label="Remaining" value={`${d.effort.remainingHours}h`} hint={d.effort.remainingBasis} />
            <Stat label="Working days left" value={d.effort.workDays} />
          </div>
          <div className={`mt-3 rounded-lg p-3 text-sm ${overCapacity ? "bg-danger-soft text-danger" : "bg-surface-2"}`}>
            {d.effort.requiredPerDay === null ? (
              <p>No working days remain before the target date. Extend the date or reduce scope.</p>
            ) : (
              <p>
                Required pace: <strong>{d.effort.requiredPerDay}h per working day</strong> (your capacity is {d.effort.capacityPerDay}h).
                {overCapacity ? " This goal alone exceeds your available time." : ""}
              </p>
            )}
          </div>
          <p className="mt-2 text-xs text-muted">
            {d.effort.historicalFactor === null
              ? "Estimates are assumptions until you finish at least 5 timed tasks."
              : `Measured: your tasks take ${d.effort.historicalFactor}× their estimates on average.`}
          </p>
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Contributing goals"
            subtitle={g.metricType === "children" ? "Progress rolls up from these, weighted." : undefined}
            action={
              g.level !== "week" ? (
                <LinkButton size="sm" href={`/goals/new?parent=${g.id}`}>
                  <Plus size={14} /> Add
                </LinkButton>
              ) : null
            }
          />
          {d.children.length ? (
            <ul className="space-y-3">
              {d.children.map((c) => (
                <li key={c.id} className="flex gap-2">
                  <GoalSummaryRow g={c} />
                  <span className="text-xs text-muted">w{c.weight}</span>
                </li>
              ))}
            </ul>
          ) : (
            <EmptyState title="No child goals">Break this goal into shorter-horizon targets.</EmptyState>
          )}
        </Card>

        <Card>
          <CardHeader title="Milestones" subtitle={g.metricType === "milestones" ? "Progress is calculated from these weights." : "Checkpoints for this goal."} />
          <MilestoneList
            items={d.milestones.map((m) => ({ id: m.id, title: m.title, weight: m.weight, dueDate: m.dueDate, done: Boolean(m.completedAt) }))}
          />
          <ActionForm action={addMilestoneAction.bind(null, g.id)} resetOnSuccess className="mt-3 grid gap-2 border-t border-border pt-3 sm:grid-cols-[1fr_7rem_5rem_auto] sm:items-end">
            <Field label="Milestone" htmlFor="ms-title">
              <Input id="ms-title" name="title" placeholder="e.g. Finish first draft" />
              <FieldError name="title" />
            </Field>
            <Field label="Due" htmlFor="ms-due">
              <Input id="ms-due" name="dueDate" type="date" min={g.startDate} max={g.targetDate} />
            </Field>
            <Field label="Weight" htmlFor="ms-weight">
              <Input id="ms-weight" name="weight" type="number" step="0.1" min="0.1" defaultValue={1} />
            </Field>
            <SubmitButton variant="secondary">Add</SubmitButton>
          </ActionForm>
        </Card>
      </div>

      <Card>
        <CardHeader
          title="Daily tasks"
          subtitle={`Tasks linked to this goal and its sub-goals · ${doneTasks.length} done, ${openTasks.length} open`}
          action={
            <LinkButton size="sm" href={`/tasks?new=1&goal=${g.id}`}>
              <Plus size={14} /> Task
            </LinkButton>
          }
        />
        {d.tasks.length ? (
          <ul className="divide-y divide-border">
            {[...openTasks, ...doneTasks].slice(0, 50).map((t) => (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <Link href={`/tasks/${t.id}`} className={`text-sm hover:underline ${t.status === "done" ? "text-muted line-through" : ""}`}>
                  {t.title}
                </Link>
                <span className="flex items-center gap-2 text-xs text-muted">
                  {t.scheduledStart ? formatInstant(t.scheduledStart, tz) : t.dueAt ? `due ${formatInstant(t.dueAt, tz, "d LLL")}` : "unscheduled"}
                  <Badge tone={t.status === "done" ? "ok" : t.status === "blocked" ? "danger" : "neutral"}>{TASK_STATUS_LABEL[t.status]}</Badge>
                  {formatMinutes(t.actualMinutes)} / {formatMinutes(t.estimatedMinutes)}
                </span>
              </li>
            ))}
          </ul>
        ) : (
          <EmptyState title="No tasks linked yet">Add tasks so daily work counts towards this goal.</EmptyState>
        )}
      </Card>

      <Card>
        <details>
          <summary className="cursor-pointer font-semibold">Edit goal</summary>
          <div className="mt-4">
            <GoalForm
              action={updateGoalAction.bind(null, g.id)}
              submitLabel="Save changes"
              excludeIds={excluded}
              parents={d.allGoals.map((x) => ({ id: x.id, title: x.title, level: x.level, startDate: x.startDate, targetDate: x.targetDate }))}
              defaults={{
                title: g.title,
                description: g.description,
                level: g.level,
                parentId: g.parentId,
                category: g.category,
                startDate: g.startDate,
                targetDate: g.targetDate,
                metricType: g.metricType,
                unit: g.unit,
                direction: g.direction,
                startValue: g.startValue,
                targetValue: g.targetValue,
                currentValue: g.currentValue,
                priority: g.priority,
                status: g.status,
                estimatedHours: g.estimatedHours,
                weight: g.weight,
              }}
            />
          </div>
        </details>
      </Card>
    </div>
  );
}
