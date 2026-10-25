import Link from "next/link";
import { Card, LinkButton, PageHeader, cn } from "@/components/ui";
import { NewTaskButton } from "@/components/tasks/task-list";
import { DayTimeline, type TimelineItem } from "@/components/planner/timeline";
import { WeekGrid, type CalDay, type CalItem } from "@/components/planner/week-grid";
import { addDays, eachDate, formatDate, formatInstant, isoWeekday, localToInstant, periodContaining, shiftPeriod, todayIn } from "@/lib/domain/periods";
import { commitmentsOn, overlappingPairs } from "@/lib/domain/scheduling";
import { requireAuth } from "@/server/auth/session";
import { listSchedules } from "@/server/services/account";
import { goalOptions } from "@/server/services/task-view";
import { materializeRecurring, tasksInRange } from "@/server/services/tasks";

export const metadata = { title: "Calendar" };

const VIEWS = ["day", "week", "month"] as const;
type View = (typeof VIEWS)[number];

/** Local wall-clock minute → instant (DST-safe, unlike adding minutes to midnight). */
function atMinute(date: string, min: number, tz: string) {
  if (min >= 24 * 60) return localToInstant(addDays(date, 1), "00:00", tz);
  return localToInstant(date, `${String(Math.floor(min / 60)).padStart(2, "0")}:${String(min % 60).padStart(2, "0")}`, tz);
}

function minutesOfDay(d: Date, tz: string) {
  return Number(formatInstant(d, tz, "H")) * 60 + Number(formatInstant(d, tz, "m"));
}

export default async function CalendarPage({ searchParams }: { searchParams: Promise<{ view?: string; date?: string }> }) {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const view: View = (VIEWS as readonly string[]).includes(sp.view ?? "") ? (sp.view as View) : "week";
  const today = todayIn(tz);
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : today;
  const period = periodContaining(view, date, tz, prefs.weekStartsOn);
  // Month view shows whole weeks around the month.
  const gridStart = view === "month" ? periodContaining("week", period.start, tz, prefs.weekStartsOn).start : period.start;
  const gridEnd = view === "month" ? periodContaining("week", period.end, tz, prefs.weekStartsOn).end : period.end;
  const from = periodContaining("day", gridStart, tz).startInstant;
  const to = periodContaining("day", gridEnd, tz).endExclusive;

  await materializeRecurring(user.id, from, to);
  const [rows, schedules, goals] = await Promise.all([tasksInRange(user.id, from, to), listSchedules(user.id), goalOptions(user.id)]);
  const dates = eachDate(gridStart, gridEnd);
  const prev = shiftPeriod(period, -1, tz, prefs.weekStartsOn).start;
  const next = shiftPeriod(period, 1, tz, prefs.weekStartsOn).start;
  const link = (patch: { view?: View; date?: string }) => `/calendar?view=${patch.view ?? view}&date=${patch.date ?? date}`;
  const [ph] = prefs.preferredStart.split(":").map(Number);
  const [eh] = prefs.preferredEnd.split(":").map(Number);

  const items: CalItem[] = [];
  for (const r of rows) {
    const t = r.task;
    if (t.status === "deferred") continue;
    if (t.scheduledStart) {
      const end = t.scheduledEnd ?? new Date(t.scheduledStart.getTime() + (t.estimatedMinutes ?? 30) * 60_000);
      const day = formatInstant(t.scheduledStart, tz, "yyyy-MM-dd");
      const startMin = minutesOfDay(t.scheduledStart, tz);
      const sameDay = formatInstant(end, tz, "yyyy-MM-dd") === day;
      items.push({
        id: t.id,
        title: t.title,
        date: day,
        startMin,
        endMin: sameDay ? Math.max(startMin + 15, minutesOfDay(end, tz)) : 24 * 60,
        timeLabel: `${formatInstant(t.scheduledStart, tz, "HH:mm")}–${formatInstant(end, tz, "HH:mm")}`,
        status: t.status,
        priority: t.priority,
        kind: "task",
      });
    } else if (t.dueAt) {
      items.push({
        id: t.id,
        title: t.title,
        date: formatInstant(t.dueAt, tz, "yyyy-MM-dd"),
        startMin: null,
        endMin: null,
        timeLabel: `due ${formatInstant(t.dueAt, tz, "HH:mm")}`,
        status: t.status,
        priority: t.priority,
        kind: "task",
      });
    }
  }
  for (const d of dates) {
    for (const c of commitmentsOn(d, tz, schedules)) {
      const startMin = minutesOfDay(c.start, tz);
      const endMin = formatInstant(c.end, tz, "yyyy-MM-dd") === d ? minutesOfDay(c.end, tz) : 24 * 60;
      items.push({ id: c.id, title: c.label, date: d, startMin, endMin, timeLabel: `${formatInstant(c.start, tz, "HH:mm")}–${formatInstant(c.end, tz, "HH:mm")}`, status: "todo", priority: "medium", kind: "commitment" });
    }
  }
  // Flag overlaps between open timed items on the same day.
  const conflictIds = new Set<string>();
  for (const d of dates) {
    const sameDay = items
      .filter((i) => i.date === d && i.startMin !== null && i.status !== "done")
      .map((i) => ({ id: i.id, label: i.title, start: new Date(i.startMin! * 60_000), end: new Date(i.endMin! * 60_000) }));
    for (const [a, b] of overlappingPairs(sameDay)) {
      conflictIds.add(a.id);
      conflictIds.add(b.id);
    }
  }
  items.forEach((i) => (i.conflict = conflictIds.has(i.id)));
  const working = new Set(prefs.workingDays);
  const days: CalDay[] = dates.map((d) => ({
    date: d,
    label: formatDate(d, view === "day" ? "cccc d LLL" : "ccc d"),
    isToday: d === today,
    working: working.has(isoWeekday(d)),
  }));

  return (
    <div className="space-y-5">
      <PageHeader
        title="Calendar"
        subtitle={period.label}
        actions={
          <>
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Calendar view">
              {VIEWS.map((v) => (
                <Link key={v} href={link({ view: v })} className={cn("rounded-md px-2.5 py-1 text-sm capitalize", view === v && "bg-accent-soft text-accent")} aria-current={view === v ? "page" : undefined}>
                  {v}
                </Link>
              ))}
            </div>
            <LinkButton size="sm" href={link({ date: prev })} aria-label="Previous">
              ←
            </LinkButton>
            <LinkButton size="sm" href={link({ date: today })}>
              Today
            </LinkButton>
            <LinkButton size="sm" href={link({ date: next })} aria-label="Next">
              →
            </LinkButton>
            <NewTaskButton goals={goals} />
          </>
        }
      />
      <Card>
        {view === "week" ? (
          <WeekGrid days={days} items={items} fromHour={Math.max(0, (ph ?? 9) - 1)} toHour={Math.min(24, (eh ?? 17) + 1)} />
        ) : view === "day" ? (
          <DayView date={date} tz={tz} items={items} fromHour={Math.max(0, (ph ?? 9) - 1)} toHour={Math.min(24, (eh ?? 17) + 2)} />
        ) : (
          <MonthView days={days} items={items} monthStart={period.start} monthEnd={period.end} />
        )}
      </Card>
    </div>
  );
}

function DayView({ date, tz, items, fromHour, toHour }: { date: string; tz: string; items: CalItem[]; fromHour: number; toHour: number }) {
  const day = periodContaining("day", date, tz);
  const timed: TimelineItem[] = items
    .filter((i) => i.date === date && i.startMin !== null)
    .map((i) => ({
      id: i.id,
      label: i.title,
      start: atMinute(date, i.startMin!, tz),
      end: atMinute(date, i.endMin!, tz),
      kind: i.kind,
      status: i.status,
      conflict: i.conflict,
      href: i.kind === "task" ? `/tasks/${i.id}` : undefined,
    }));
  const due = items.filter((i) => i.date === date && i.startMin === null);
  return (
    <div className="space-y-3">
      {due.length ? (
        <div>
          <p className="mb-1 text-xs font-medium text-muted">Due today (no start time)</p>
          <ul className="flex flex-wrap gap-1.5">
            {due.map((i) => (
              <li key={i.id}>
                <Link href={`/tasks/${i.id}`} className={cn("rounded border border-border px-2 py-0.5 text-sm hover:bg-surface-2", i.status === "done" && "line-through opacity-60")}>
                  {i.title} <span className="text-xs text-muted">{i.timeLabel}</span>
                </Link>
              </li>
            ))}
          </ul>
        </div>
      ) : null}
      <DayTimeline items={timed} dayStart={day.startInstant} tz={tz} fromHour={fromHour} toHour={toHour} />
      <p className="text-xs text-muted">
        To plan this day in detail, open <Link className="underline" href={`/today?date=${date}`}>My Day</Link>. Drag-and-drop rescheduling is in the week view.
      </p>
    </div>
  );
}

function MonthView({ days, items, monthStart, monthEnd }: { days: CalDay[]; items: CalItem[]; monthStart: string; monthEnd: string }) {
  const header = days.slice(0, 7).map((d) => formatDate(d.date, "ccc"));
  return (
    <div>
      <div className="grid grid-cols-7 border-b border-border text-center text-xs text-muted">
        {header.map((h) => (
          <div key={h} className="py-1">
            {h}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7">
        {days.map((d) => {
          const dayItems = items.filter((i) => i.date === d.date && i.kind === "task");
          const inMonth = d.date >= monthStart && d.date <= monthEnd;
          const open = dayItems.filter((i) => i.status !== "done").length;
          return (
            <Link
              key={d.date}
              href={`/today?date=${d.date}`}
              className={cn("min-h-16 border-b border-l border-border p-1 text-left hover:bg-surface-2 sm:min-h-24", !inMonth && "opacity-45", !d.working && "bg-surface-2/40")}
              aria-label={`${formatDate(d.date, "cccc d LLLL")}: ${dayItems.length} tasks`}
            >
              <span className={cn("inline-flex h-6 w-6 items-center justify-center rounded-full text-xs", d.isToday && "bg-accent text-accent-fg")}>{Number(d.date.slice(8))}</span>
              <ul className="hidden space-y-0.5 sm:block">
                {dayItems.slice(0, 3).map((i) => (
                  <li key={i.id} className={cn("truncate rounded bg-accent-soft px-1 text-[11px]", i.status === "done" && "line-through opacity-60", i.conflict && "text-danger")}>
                    {i.title}
                  </li>
                ))}
                {dayItems.length > 3 ? <li className="text-[11px] text-muted">+{dayItems.length - 3} more</li> : null}
              </ul>
              {dayItems.length ? <span className="block text-[10px] text-muted sm:hidden">{open ? `${open} open` : "✓"}</span> : null}
            </Link>
          );
        })}
      </div>
    </div>
  );
}
