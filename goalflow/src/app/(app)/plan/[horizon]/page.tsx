import Link from "next/link";
import { notFound } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, Card, CardHeader, EmptyState, Field, LinkButton, PageHeader, ProgressBar, Stat, Textarea, cn } from "@/components/ui";
import { GoalSummaryRow } from "@/components/goals/goal-bits";
import { CarryAllButton } from "@/components/planner/carry-all";
import { Rebalance } from "@/components/planner/rebalance";
import { SummaryCard } from "@/components/review/summary-card";
import { PERIOD_LABEL, PERIOD_TYPES, TASK_STATUS_LABEL, type PeriodType } from "@/lib/constants";
import { features } from "@/lib/env";
import { addDays, eachDate, formatDate, shiftPeriod, todayIn } from "@/lib/domain/periods";
import { workloadByDay } from "@/lib/domain/scheduling";
import { formatMinutes } from "@/lib/domain/timer";
import { titleCase } from "@/lib/format";
import { saveReflectionAction } from "@/server/actions/reviews";
import { requireAuth } from "@/server/auth/session";
import { periodReview } from "@/server/services/reviews";
import { toLoadTask } from "@/server/services/tasks";

export async function generateMetadata({ params }: { params: Promise<{ horizon: string }> }) {
  const { horizon } = await params;
  return { title: (PERIOD_TYPES as readonly string[]).includes(horizon) ? `${PERIOD_LABEL[horizon as PeriodType]} planning` : "Planning" };
}

const REFLECTION: { name: "wins" | "obstacles" | "lessons" | "decisions" | "nextPriorities"; label: string; hint: string }[] = [
  { name: "wins", label: "Wins", hint: "What went well?" },
  { name: "obstacles", label: "Obstacles", hint: "What got in the way?" },
  { name: "lessons", label: "Lessons learned", hint: "What would you do differently?" },
  { name: "decisions", label: "Decisions and plan adjustments", hint: "What are you changing: targets, schedule, scope?" },
  { name: "nextPriorities", label: "Next priorities", hint: "The most important outcomes for the next period." },
];

function Delta({ now, before, unit = "" }: { now: number; before: number; unit?: string }) {
  if (!before && !now) return null;
  const d = Math.round((now - before) * 10) / 10;
  if (d === 0) return <span className="text-muted">same as last period</span>;
  return (
    <span className={d > 0 ? "text-ok" : "text-danger"}>
      {d > 0 ? "▲" : "▼"} {Math.abs(d)}
      {unit} vs last period
    </span>
  );
}

export default async function PlanPage({ params, searchParams }: { params: Promise<{ horizon: string }>; searchParams: Promise<{ date?: string }> }) {
  const { horizon } = await params;
  if (!(PERIOD_TYPES as readonly string[]).includes(horizon)) notFound();
  const type = horizon as PeriodType;
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const today = todayIn(tz);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const r = await periodReview(user.id, prefs, type, date);
  const { period, metrics: m, prevMetrics: pm, report } = r;
  const next = shiftPeriod(period, 1, tz, prefs.weekStartsOn);
  const prevStart = shiftPeriod(period, -1, tz, prefs.weekStartsOn).start;
  const isCurrent = today >= period.start && today <= period.end;
  const isPast = today > period.end;
  const carryTarget = type === "day" ? addDays(period.start, 1) : next.start;
  const openIds = m.unfinished.filter((u) => u.status !== "deferred").map((u) => u.id);
  const maxChild = Math.max(1, ...r.breakdown.map((b) => b.metrics.focusMinutes));
  const workload = type === "week" ? workloadByDay(eachDate(period.start, period.end), tz, r.tasks.map(toLoadTask), prefs) : [];
  const overloaded = workload.filter((d) => d.overload > 0);
  const categories = Object.entries(m.minutesByCategory).sort((a, b) => b[1] - a[1]);

  return (
    <div className="space-y-5">
      <PageHeader
        title={`${PERIOD_LABEL[type]} planning & review`}
        subtitle={`${period.label}${isCurrent ? " · current" : isPast ? " · past" : " · upcoming"}`}
        actions={
          <>
            <LinkButton size="sm" href={`/plan/${type}?date=${prevStart}`}>
              ← Previous
            </LinkButton>
            {!isCurrent ? (
              <LinkButton size="sm" href={`/plan/${type}`}>
                Current
              </LinkButton>
            ) : null}
            <LinkButton size="sm" href={`/plan/${type}?date=${next.start}`}>
              Next →
            </LinkButton>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Completed (planned)" value={`${m.completedPlanned} / ${m.planned}`} hint={m.completed !== m.completedPlanned ? `${m.completed} completed in total` : undefined} />
        <Stat label="Completion rate" value={`${m.completionRate}%`} hint={<Delta now={m.completionRate} before={pm.completionRate} unit=" pts" />} />
        <Stat label="Focus time" value={formatMinutes(m.focusMinutes)} hint={m.plannedMinutes ? `estimated ${formatMinutes(m.plannedMinutes)}` : <Delta now={Math.round(m.focusMinutes / 6) / 10} before={Math.round(pm.focusMinutes / 6) / 10} unit="h" />} />
        <Stat label="On time" value={m.onTimeRate === null ? "–" : `${m.onTimeRate}%`} hint={`${m.blocked} blocked · ${m.deferred} deferred · ${m.carriedOver} carried over`} />
      </div>

      <div className="grid gap-5 lg:grid-cols-5">
        <div className="space-y-5 lg:col-span-3">
          <Card>
            <CardHeader
              title="Goals for this period"
              subtitle="Progress now compared with where you should be by the end of this period."
              action={
                <LinkButton size="sm" href="/goals/plan">
                  Break down a goal
                </LinkButton>
              }
            />
            {r.goals.length ? (
              <ul className="divide-y divide-border">
                {r.goals.map((g) => (
                  <li key={g.id} className="py-2.5">
                    <GoalSummaryRow g={g} />
                  </li>
                ))}
              </ul>
            ) : (
              <EmptyState title="No goals for this period">
                Add a {type === "day" ? "weekly" : type === "half" ? "six-month" : PERIOD_LABEL[type].toLowerCase()} goal, or use the guided breakdown to split a bigger goal.
              </EmptyState>
            )}
          </Card>

          {type === "week" ? (
            <Card>
              <CardHeader title="Workload this week" subtitle="Planned open work per day against your available hours." />
              <ul className="space-y-2">
                {workload.map((d) => (
                  <li key={d.date} className="grid grid-cols-[4.5rem_1fr_7rem] items-center gap-2 text-sm">
                    <Link href={`/today?date=${d.date}`} className={cn("hover:underline", d.date === today && "font-semibold text-accent")}>
                      {formatDate(d.date, "EEE d")}
                    </Link>
                    <ProgressBar value={d.capacity ? (d.planned / d.capacity) * 100 : d.planned ? 100 : 0} label={`${d.date} load`} />
                    <span className={cn("text-right text-xs tabular-nums", d.overload > 0 ? "text-danger" : "text-muted")}>
                      {formatMinutes(d.planned)} / {formatMinutes(d.capacity)}
                    </span>
                  </li>
                ))}
              </ul>
              {overloaded.length ? (
                <div className="mt-4 border-t border-border pt-3">
                  <p className="mb-2 text-sm text-danger">
                    {overloaded.length} day{overloaded.length === 1 ? " is" : "s are"} over capacity. GoalFlow can propose moves; you approve each one.
                  </p>
                  <Rebalance from={period.start} to={addDays(period.end, 7)} />
                </div>
              ) : null}
            </Card>
          ) : null}

          {r.breakdown.length ? (
            <Card>
              <CardHeader title={`By ${r.breakdown[0]!.period.type === "day" ? "day" : r.breakdown[0]!.period.type}`} subtitle="Focus time and completed tasks." />
              <ul className="space-y-2">
                {r.breakdown.map((b) => (
                  <li key={b.period.start} className="grid grid-cols-[minmax(5rem,9rem)_1fr_auto] items-center gap-2 text-sm">
                    <Link href={`/plan/${b.period.type}?date=${b.period.start}`} className="truncate hover:underline">
                      {b.period.type === "day" ? formatDate(b.period.start, "EEE d") : b.period.label}
                    </Link>
                    <div className="h-2 overflow-hidden rounded-full bg-surface-2" aria-hidden>
                      <div className="h-full rounded-full bg-accent" style={{ width: `${(b.metrics.focusMinutes / maxChild) * 100}%` }} />
                    </div>
                    <span className="text-xs text-muted tabular-nums">
                      {formatMinutes(b.metrics.focusMinutes)} · {b.metrics.completed} done
                    </span>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <CardHeader
              title="Not finished"
              subtitle={openIds.length ? "Nothing is deleted: carry work forward and its history is kept." : undefined}
              action={openIds.length && (type === "day" || type === "week") ? <CarryAllButton ids={openIds} to={carryTarget} label={`Move all to ${formatDate(carryTarget, "EEE d LLL")}`} /> : null}
            />
            {m.unfinished.length ? (
              <ul className="divide-y divide-border">
                {m.unfinished.map((t) => (
                  <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                    <Link href={`/tasks/${t.id}`} className="flex-1 hover:underline">
                      {t.title}
                    </Link>
                    <Badge tone={t.status === "blocked" ? "danger" : "neutral"}>{TASK_STATUS_LABEL[t.status]}</Badge>
                    <Badge tone={t.priority === "critical" ? "danger" : t.priority === "high" ? "warn" : "neutral"}>{t.priority}</Badge>
                    {t.carryOverCount ? <Badge>carried {t.carryOverCount}×</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">{m.planned ? "Everything planned was finished." : "Nothing was planned for this period."}</p>
            )}
          </Card>

          <Card>
            <CardHeader title="Completed" subtitle={`${m.done.length} task${m.done.length === 1 ? "" : "s"}`} />
            {m.done.length ? (
              <ul className="divide-y divide-border">
                {m.done.map((t) => (
                  <li key={t.id} className="flex items-center gap-2 py-2 text-sm">
                    <Link href={`/tasks/${t.id}`} className="flex-1 hover:underline">
                      {t.title}
                    </Link>
                    <span className="text-xs text-muted tabular-nums">
                      {formatMinutes(t.actualMinutes)}
                      {t.estimatedMinutes ? ` / ${formatMinutes(t.estimatedMinutes)} est.` : ""}
                    </span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No tasks completed in this period.</p>
            )}
          </Card>
        </div>

        <div className="space-y-5 lg:col-span-2">
          <Card>
            <CardHeader title={type === "day" ? "Daily summary" : "Summary"} subtitle="What got done, what didn't, and where the time went." />
            <SummaryCard periodType={type} date={period.start} initial={report?.summary ?? ""} initialSource={report?.summarySource ?? "none"} aiEnabled={features().ai} />
          </Card>

          <Card>
            <CardHeader title="Where the time went" />
            {categories.length ? (
              <ul className="space-y-1.5 text-sm">
                {categories.map(([c, min]) => (
                  <li key={c} className="flex justify-between">
                    <span>{c === "unlinked" ? "Not linked to a goal" : titleCase(c)}</span>
                    <span className="tabular-nums">{formatMinutes(min)}</span>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No focus time recorded.</p>
            )}
            {m.breakMinutes ? <p className="mt-2 text-xs text-muted">Plus {formatMinutes(m.breakMinutes)} of breaks.</p> : null}
          </Card>

          <Card>
            <CardHeader title="Reflection" subtitle={report?.updatedAt ? `Saved ${formatDate(report.updatedAt.toISOString().slice(0, 10))}` : "Saved with a snapshot of this period's numbers."} />
            <ActionForm action={saveReflectionAction.bind(null, type, period.start)} className="space-y-3">
              {REFLECTION.map((f) => (
                <Field key={f.name} label={f.label} htmlFor={`rf-${f.name}`}>
                  <Textarea id={`rf-${f.name}`} name={f.name} rows={2} placeholder={f.hint} defaultValue={report?.[f.name] ?? ""} />
                </Field>
              ))}
              <SubmitButton>Save review</SubmitButton>
            </ActionForm>
          </Card>

          <Card>
            <CardHeader
              title="Notes from this period"
              action={
                type === "day" ? (
                  <LinkButton size="sm" href={`/notes/journal?date=${period.start}`}>
                    Journal
                  </LinkButton>
                ) : null
              }
            />
            {r.notes.length ? (
              <ul className="space-y-1.5 text-sm">
                {r.notes.map((n) => (
                  <li key={n.id}>
                    <Link href={`/notes/${n.id}`} className="hover:underline">
                      {n.title || n.body.slice(0, 60)}
                    </Link>
                    {n.kind === "journal" ? <Badge className="ml-1">journal</Badge> : null}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No notes written in this period.</p>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
