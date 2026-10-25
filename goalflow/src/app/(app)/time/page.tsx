import Link from "next/link";
import { Download } from "lucide-react";
import { desc, eq } from "drizzle-orm";
import { Card, CardHeader, EmptyState, LinkButton, PageHeader, Stat, cn } from "@/components/ui";
import { SessionEditor, SessionList } from "@/components/tasks/task-detail-client";
import { eachDate, formatDate, periodContaining, shiftPeriod, todayIn } from "@/lib/domain/periods";
import { formatMinutes } from "@/lib/domain/timer";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { toSessionRow } from "@/server/services/task-view";
import { buildTimesheet, type TimesheetRow } from "@/server/services/timesheet";

export const metadata = { title: "Timesheet" };

function Breakdown({ rows, total }: { rows: TimesheetRow[]; total: number }) {
  if (!rows.length) return <p className="text-sm text-muted">No time recorded.</p>;
  return (
    <ul className="space-y-2">
      {rows.map((r) => (
        <li key={r.key} className="text-sm">
          <div className="flex justify-between gap-2">
            {r.href ? (
              <Link href={r.href} className="truncate hover:underline">
                {r.label}
              </Link>
            ) : (
              <span className="truncate text-muted">{r.label}</span>
            )}
            <span className="shrink-0 tabular-nums">
              {formatMinutes(r.focus)}
              {r.breaks ? <span className="text-muted"> + {formatMinutes(r.breaks)} break</span> : null}
            </span>
          </div>
          <div className="mt-1 h-1.5 overflow-hidden rounded-full bg-surface-2" aria-hidden>
            <div className="h-full rounded-full bg-accent" style={{ width: `${total ? Math.round((r.focus / total) * 100) : 0}%` }} />
          </div>
        </li>
      ))}
    </ul>
  );
}

export default async function TimesheetPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const view = sp.view === "day" || sp.view === "month" ? sp.view : "week";
  const today = todayIn(tz);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const period = periodContaining(view, date, tz, prefs.weekStartsOn);
  const dates = eachDate(period.start, period.end);
  const [sheet, tasks] = await Promise.all([
    buildTimesheet(user.id, tz, dates),
    db().select({ id: s.tasks.id, title: s.tasks.title }).from(s.tasks).where(eq(s.tasks.userId, user.id)).orderBy(desc(s.tasks.updatedAt)).limit(200),
  ]);
  const link = (patch: { view?: string; date?: string }) => `/time?view=${patch.view ?? view}&date=${patch.date ?? date}`;
  const maxDay = Math.max(1, ...sheet.days.map((d) => d.focus + d.breaks));
  const workedDays = sheet.days.filter((d) => d.focus > 0).length;
  const manual = sheet.sessions.filter((r) => r.session.source !== "timer").length;

  return (
    <div className="space-y-5">
      <PageHeader
        title="Timesheet"
        subtitle={period.label}
        actions={
          <>
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Range">
              {(["day", "week", "month"] as const).map((v) => (
                <Link key={v} href={link({ view: v })} className={cn("rounded-md px-2.5 py-1 text-sm capitalize", view === v && "bg-accent-soft text-accent")} aria-current={view === v ? "page" : undefined}>
                  {v}
                </Link>
              ))}
            </div>
            <LinkButton size="sm" href={link({ date: shiftPeriod(period, -1, tz, prefs.weekStartsOn).start })} aria-label="Previous">
              ←
            </LinkButton>
            <LinkButton size="sm" href={link({ date: today })}>
              Today
            </LinkButton>
            <LinkButton size="sm" href={link({ date: shiftPeriod(period, 1, tz, prefs.weekStartsOn).start })} aria-label="Next">
              →
            </LinkButton>
            <a className="inline-flex items-center gap-1 rounded-lg border border-border px-2.5 py-1 text-sm hover:bg-surface-2" href={`/api/export/timesheet?from=${period.start}&to=${period.end}`}>
              <Download size={14} /> CSV
            </a>
          </>
        }
      />

      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <Stat label="Focus time" value={formatMinutes(sheet.focus)} />
        <Stat label="Breaks" value={formatMinutes(sheet.breaks)} />
        <Stat label={view === "day" ? "Sessions" : "Days worked"} value={view === "day" ? sheet.sessions.length : `${workedDays} / ${dates.length}`} />
        <Stat label="Average per worked day" value={formatMinutes(workedDays ? Math.round(sheet.focus / workedDays) : 0)} hint={manual ? `${manual} manual entr${manual === 1 ? "y" : "ies"}` : undefined} />
      </div>

      {view !== "day" ? (
        <Card>
          <CardHeader title="Per day" />
          <div className="flex h-40 items-end gap-1" role="img" aria-label="Focus minutes per day">
            {sheet.days.map((d) => (
              <Link
                key={d.key}
                href={link({ view: "day", date: d.key })}
                className="group flex h-full min-w-0 flex-1 flex-col justify-end"
                title={`${formatDate(d.key, "EEE d LLL")}: ${formatMinutes(d.focus)} focus, ${formatMinutes(d.breaks)} breaks`}
              >
                <div className="rounded-t bg-info/40" style={{ height: `${(d.breaks / maxDay) * 85}%` }} />
                <div className={cn("bg-accent group-hover:opacity-80", d.breaks ? "" : "rounded-t")} style={{ height: `${(d.focus / maxDay) * 85}%` }} />
                <span className={cn("mt-1 truncate text-center text-[10px] text-muted", d.key === today && "font-semibold text-accent")}>{formatDate(d.key, view === "week" ? "EEE" : "d")}</span>
              </Link>
            ))}
          </div>
          <p className="mt-2 text-xs text-muted">Dark: focus · light: breaks. Select a day to see its sessions.</p>
        </Card>
      ) : null}

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="By task" />
          <Breakdown rows={sheet.tasks} total={sheet.focus} />
        </Card>
        <Card>
          <CardHeader title="By goal" />
          <Breakdown rows={sheet.goals} total={sheet.focus} />
        </Card>
      </div>

      <Card>
        <CardHeader title="Sessions" subtitle="Correct a session with the pencil; every correction is kept in the audit log." />
        {sheet.sessions.length ? (
          <SessionList rows={sheet.sessions.map((r) => toSessionRow(r.session, tz, r.taskTitle))} showTask />
        ) : (
          <EmptyState title="No sessions in this range">Start a timer from any task, or add time manually below.</EmptyState>
        )}
        <details className="mt-3 border-t border-border pt-3">
          <summary className="cursor-pointer text-sm font-medium">Add time manually</summary>
          <div className="mt-3">
            <SessionEditor taskId={null} tasks={tasks} />
          </div>
        </details>
      </Card>
    </div>
  );
}
