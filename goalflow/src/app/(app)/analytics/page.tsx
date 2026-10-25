import Link from "next/link";
import { Card, CardHeader, EmptyState, PageHeader, Select, Stat, buttonClass, cn, Input } from "@/components/ui";
import { CompletionChart, FocusChart, GoalHistoryChart, HourChart } from "@/components/analytics/charts";
import { addDays, formatDate, todayIn } from "@/lib/domain/periods";
import { formatMinutes } from "@/lib/domain/timer";
import { titleCase } from "@/lib/format";
import { requireAuth } from "@/server/auth/session";
import { analytics } from "@/server/services/analytics";

export const metadata = { title: "Analytics" };

const PRESETS = [
  ["7", "7 days"],
  ["30", "30 days"],
  ["90", "90 days"],
  ["365", "12 months"],
] as const;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function BarList({ rows, total, hrefFor }: { rows: { key: string; label: string; minutes: number }[]; total: number; hrefFor?: (key: string) => string | undefined }) {
  if (!rows.length) return <p className="text-sm text-muted">No focus time recorded in this range.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => {
        const href = hrefFor?.(r.key);
        return (
          <li key={r.key} className="text-sm">
            <div className="flex justify-between gap-2">
              {href ? (
                <Link href={href} className="truncate hover:underline">
                  {r.label}
                </Link>
              ) : (
                <span className="truncate">{r.label}</span>
              )}
              <span className="shrink-0 text-muted tabular-nums">
                {formatMinutes(r.minutes)} · {total ? Math.round((r.minutes / total) * 100) : 0}%
              </span>
            </div>
            <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
              <div className="h-full rounded-full bg-series-1" style={{ width: `${total ? (r.minutes / total) * 100 : 0}%` }} />
            </div>
          </li>
        );
      })}
    </ul>
  );
}

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ range?: string; from?: string; to?: string; goal?: string }> }) {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const today = todayIn(tz);
  const custom = sp.from && sp.to && DATE.test(sp.from) && DATE.test(sp.to) && sp.from <= sp.to;
  const days = PRESETS.some(([d]) => d === sp.range) ? Number(sp.range) : 30;
  let from = custom ? sp.from! : addDays(today, -(days - 1));
  const to = custom ? sp.to! : today;
  if (addDays(from, 400) < to) from = addDays(to, -400);
  const goalId = sp.goal && /^[0-9a-f-]{36}$/.test(sp.goal) ? sp.goal : undefined;
  const a = await analytics(user.id, prefs, from, to, goalId);
  const longRange = a.perDay.length > 62;
  const focusData = a.perDay.map((d) => ({ ...d, label: formatDate(d.date, longRange ? "d LLL" : a.perDay.length > 14 ? "d" : "EEE d") }));
  const completion = a.statusCounts.planned ? Math.round((a.statusCounts.done / a.statusCounts.planned) * 100) : null;
  const q = (patch: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ range: sp.range, from: sp.from, to: sp.to, goal: sp.goal, ...patch })) if (v) p.set(k, v);
    return `/analytics?${p.toString()}`;
  };
  const empty = a.totalFocus === 0 && a.statusCounts.planned === 0;

  return (
    <div className="space-y-5">
      <PageHeader title="Analytics" subtitle={`${formatDate(from)} – ${formatDate(to)}`} />

      <Card className="flex flex-wrap items-end gap-3">
        <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Date range">
          {PRESETS.map(([d, l]) => (
            <Link key={d} href={q({ range: d, from: undefined, to: undefined })} className={cn("rounded-md px-2.5 py-1 text-sm", !custom && days === Number(d) && "bg-accent-soft text-accent")}>
              {l}
            </Link>
          ))}
        </div>
        <form className="flex flex-wrap items-end gap-2" aria-label="Custom range">
          {sp.goal ? <input type="hidden" name="goal" value={sp.goal} /> : null}
          <label className="text-xs text-muted">
            From
            <Input type="date" name="from" defaultValue={from} className="mt-0.5 h-8 w-40" />
          </label>
          <label className="text-xs text-muted">
            To
            <Input type="date" name="to" defaultValue={to} max={today} className="mt-0.5 h-8 w-40" />
          </label>
          <button type="submit" className={buttonClass("secondary", "sm")}>
            Apply
          </button>
        </form>
      </Card>

      {empty ? (
        <EmptyState title="Nothing to analyse yet">Plan tasks and record focus time; charts fill in from your real activity.</EmptyState>
      ) : null}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Focus time" value={formatMinutes(a.totalFocus)} hint={`${a.activeDays} active day${a.activeDays === 1 ? "" : "s"} · ${formatMinutes(a.activeDays ? Math.round(a.totalFocus / a.activeDays) : 0)} per active day`} />
        <Stat label="Planned tasks completed" value={completion === null ? "–" : `${completion}%`} hint={`${a.statusCounts.done} of ${a.statusCounts.planned}`} />
        <Stat
          label="Estimates within ±20%"
          value={a.accuracy.samples ? `${a.accuracy.withinTwentyPct}%` : "–"}
          hint={a.accuracy.medianRatio ? `typical task takes ${a.accuracy.medianRatio}× its estimate (${a.accuracy.samples} tasks)` : "needs completed tasks with estimates and time"}
        />
        <Stat label="Slipped" value={a.statusCounts.carried + a.statusCounts.deferred} hint={`${a.statusCounts.carried} carried over · ${a.statusCounts.deferred} deferred · ${a.statusCounts.overdue} overdue`} />
      </div>

      <Card>
        <CardHeader title="Focus time vs plan" subtitle="Select a day to see its sessions." />
        <FocusChart data={focusData} />
        <details className="mt-2 text-sm">
          <summary className="cursor-pointer text-muted">Show as table</summary>
          <div className="mt-2 max-h-64 overflow-auto">
            <table className="w-full text-left text-xs tabular-nums">
              <thead className="text-muted">
                <tr>
                  <th className="py-1 font-medium">Date</th>
                  <th className="font-medium">Focus</th>
                  <th className="font-medium">Estimated</th>
                  <th className="font-medium">Completed</th>
                </tr>
              </thead>
              <tbody>
                {a.perDay.map((d) => (
                  <tr key={d.date} className="border-t border-border">
                    <td className="py-1">{formatDate(d.date, "EEE d LLL")}</td>
                    <td>{formatMinutes(d.focus)}</td>
                    <td>{formatMinutes(d.planned)}</td>
                    <td>{d.completed}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Weekly completion rate" subtitle="Share of planned tasks finished. Select a week to review it." />
          <CompletionChart data={a.weeks} />
        </Card>
        <Card>
          <CardHeader title="When you focus" subtitle="Focus time by hour of day." />
          <HourChart data={a.byHour} />
        </Card>
        <Card>
          <CardHeader title="Time by category" />
          <BarList rows={a.categories.map((c) => ({ key: c.key, label: c.key === "unlinked" ? "Not linked to a goal" : titleCase(c.key), minutes: c.minutes }))} total={a.totalFocus} hrefFor={(k) => (k === "unlinked" ? undefined : `/goals?category=${k}`)} />
        </Card>
        <Card>
          <CardHeader title="Time by goal" />
          <BarList rows={a.goalTime.map((g) => ({ key: g.id, label: g.title, minutes: g.minutes }))} total={a.totalFocus} hrefFor={(k) => `/goals/${k}`} />
        </Card>
      </div>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Estimate vs actual" subtitle="Completed tasks furthest from their estimate." />
          {a.overruns.length ? (
            <table className="w-full text-left text-sm tabular-nums">
              <thead className="text-xs text-muted">
                <tr>
                  <th className="py-1 font-medium">Task</th>
                  <th className="font-medium">Estimated</th>
                  <th className="font-medium">Actual</th>
                </tr>
              </thead>
              <tbody>
                {a.overruns.map((t) => (
                  <tr key={t.id} className="border-t border-border">
                    <td className="max-w-48 truncate py-1.5">
                      <Link href={`/tasks/${t.id}`} className="hover:underline">
                        {t.title}
                      </Link>
                    </td>
                    <td>{formatMinutes(t.estimated)}</td>
                    <td className={t.ratio > 1.2 ? "text-danger" : t.ratio < 0.8 ? "text-ok" : undefined}>
                      {formatMinutes(t.actual)} ({Math.round(t.ratio * 100)}%)
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          ) : (
            <p className="text-sm text-muted">Complete tasks that have an estimate and recorded time to compare them here.</p>
          )}
        </Card>
        <Card>
          <CardHeader
            title="Goal progress over time"
            action={
              <form className="flex gap-2">
                {sp.range ? <input type="hidden" name="range" value={sp.range} /> : null}
                {custom ? (
                  <>
                    <input type="hidden" name="from" value={from} />
                    <input type="hidden" name="to" value={to} />
                  </>
                ) : null}
                <Select name="goal" defaultValue={goalId ?? ""} aria-label="Goal" className="h-8 w-44">
                  <option value="">Choose a goal…</option>
                  {a.goals.map((g) => (
                    <option key={g.id} value={g.id}>
                      {g.title}
                    </option>
                  ))}
                </Select>
                <button type="submit" className={buttonClass("secondary", "sm")}>
                  Show
                </button>
              </form>
            }
          />
          {a.selectedGoal ? (
            <>
              <GoalHistoryChart data={a.snapshots} unit="" />
              <Link href={`/goals/${a.selectedGoal.id}`} className="mt-2 inline-block text-sm underline">
                Open {a.selectedGoal.title}
              </Link>
            </>
          ) : (
            <p className="text-sm text-muted">Pick a goal to see how its progress changed. Progress is recorded each time you update it.</p>
          )}
        </Card>
      </div>
    </div>
  );
}
