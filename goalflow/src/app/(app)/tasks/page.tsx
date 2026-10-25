import Link from "next/link";
import { Card, Input, LinkButton, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { NewTaskButton, QuickAdd, TaskBoard, TaskListView } from "@/components/tasks/task-list";
import { PRIORITIES, TASK_STATUS_LABEL, TASK_STATUSES, type Priority, type TaskStatus } from "@/lib/constants";
import { addDays, todayIn } from "@/lib/domain/periods";
import { titleCase } from "@/lib/format";
import { requireAuth } from "@/server/auth/session";
import { goalOptions, toTaskItem } from "@/server/services/task-view";
import { listTasks, type TaskFilters } from "@/server/services/tasks";

export const metadata = { title: "All Tasks" };

const VIEWS = [
  ["all", "All"],
  ["today", "Today"],
  ["overdue", "Overdue"],
  ["unscheduled", "Unscheduled"],
  ["upcoming", "Upcoming"],
  ["completed", "Completed"],
] as const;

type SP = { q?: string; status?: string; priority?: string; goal?: string; view?: string; sort?: string; layout?: string; new?: string };

export default async function TasksPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, prefs } = await requireAuth();
  const sp = await searchParams;
  const tz = prefs.timezone;
  const view = (VIEWS.map((v) => v[0]) as string[]).includes(sp.view ?? "") ? (sp.view as TaskFilters["view"]) : "all";
  const filters: TaskFilters = {
    q: sp.q?.trim() || undefined,
    status: (TASK_STATUSES as readonly string[]).includes(sp.status ?? "") ? [sp.status as TaskStatus] : undefined,
    priority: (PRIORITIES as readonly string[]).includes(sp.priority ?? "") ? (sp.priority as Priority) : undefined,
    goalId: sp.goal && /^[0-9a-f-]{36}$/.test(sp.goal) ? sp.goal : undefined,
    view,
    sort: (["priority", "due", "start", "created"] as const).find((s) => s === sp.sort),
  };
  const [rows, goals] = await Promise.all([listTasks(user.id, tz, filters), goalOptions(user.id)]);
  const now = new Date();
  const items = rows.map((r) => toTaskItem(r, tz, now));
  const board = sp.layout === "board";
  const today = todayIn(tz);
  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, new: undefined, ...patch })) if (v) p.set(k, v);
    return `/tasks?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="All Tasks"
        subtitle={`${items.length} task${items.length === 1 ? "" : "s"}`}
        actions={
          <>
            <div className="flex rounded-lg border border-border p-0.5" role="group" aria-label="Layout">
              <Link href={link({ layout: undefined })} className={cn("rounded-md px-2.5 py-1 text-sm", !board && "bg-accent-soft text-accent")} aria-current={!board ? "page" : undefined}>
                List
              </Link>
              <Link href={link({ layout: "board" })} className={cn("rounded-md px-2.5 py-1 text-sm", board && "bg-accent-soft text-accent")} aria-current={board ? "page" : undefined}>
                Board
              </Link>
            </div>
            <NewTaskButton goals={goals} initiallyOpen={sp.new === "1"} defaults={{ goalId: filters.goalId ?? (sp.goal || "") }} />
          </>
        }
      />
      <Card>
        <QuickAdd goals={goals} />
      </Card>
      <Card>
        <div className="mb-3 flex flex-wrap gap-1.5 text-sm" role="group" aria-label="Views">
          {VIEWS.map(([v, l]) => (
            <Link key={v} href={link({ view: v === "all" ? undefined : v })} className={cn("rounded-lg border px-2.5 py-1", view === v ? "border-accent bg-accent-soft text-accent" : "border-border")}>
              {l}
            </Link>
          ))}
        </div>
        <form className="mb-4 grid gap-2 sm:grid-cols-[1fr_9rem_9rem_12rem_9rem_auto]" role="search">
          {sp.view ? <input type="hidden" name="view" value={sp.view} /> : null}
          {sp.layout ? <input type="hidden" name="layout" value={sp.layout} /> : null}
          <Input name="q" defaultValue={sp.q} placeholder="Search tasks…" aria-label="Search tasks" />
          <Select name="status" defaultValue={sp.status ?? ""} aria-label="Status">
            <option value="">Any status</option>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <Select name="priority" defaultValue={sp.priority ?? ""} aria-label="Priority">
            <option value="">Any priority</option>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </Select>
          <Select name="goal" defaultValue={sp.goal ?? ""} aria-label="Goal">
            <option value="">Any goal</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
          <Select name="sort" defaultValue={sp.sort ?? "priority"} aria-label="Sort">
            <option value="priority">Sort: priority</option>
            <option value="due">Sort: deadline</option>
            <option value="start">Sort: start time</option>
            <option value="created">Sort: newest</option>
          </Select>
          <button type="submit" className={buttonClass("secondary")}>
            Apply
          </button>
        </form>
        {board ? (
          <TaskBoard items={items} />
        ) : (
          <TaskListView
            items={items}
            tomorrow={addDays(today, 1)}
            empty={
              <div className="py-6 text-center text-sm text-muted">
                No tasks match. <LinkButton size="sm" href="/tasks">Clear filters</LinkButton>
              </div>
            }
          />
        )}
      </Card>
    </div>
  );
}
