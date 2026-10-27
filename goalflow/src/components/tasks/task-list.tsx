"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { AlertTriangle, ArrowRightCircle, Plus, Repeat } from "lucide-react";
import { Badge, Button, Select, cn } from "@/components/ui";
import { Dialog } from "@/components/ui/dialog";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui";
import { TASK_STATUS_LABEL, TASK_STATUSES, type Priority, type TaskStatus } from "@/lib/constants";
import { formatMinutes } from "@/lib/domain/timer";
import { carryOverAction, createTaskAction, quickAddAction, setTaskStatusAction } from "@/server/actions/tasks";
import { TaskForm, type GoalOption, type TaskFormValues, emptyTask } from "./task-form";
import { StartTimerButton } from "@/components/timer/start-timer-button";

export type TaskItem = {
  id: string;
  title: string;
  status: TaskStatus;
  priority: Priority;
  goalTitle: string | null;
  goalId: string | null;
  when: string | null;
  overdue: boolean;
  estimatedMinutes: number | null;
  actualMinutes: number;
  carryOverCount: number;
  recurring: boolean;
};

const PRIORITY_TONE: Record<Priority, "danger" | "warn" | "neutral" | "info"> = { critical: "danger", high: "warn", medium: "neutral", low: "info" };

export function PriorityBadge({ p }: { p: Priority }) {
  return <Badge tone={PRIORITY_TONE[p]}>{p}</Badge>;
}

export function TaskRow({ t, tomorrow, showTimer = true }: { t: TaskItem; tomorrow?: string; showTimer?: boolean }) {
  const [pending, start] = useTransition();
  const [err, setErr] = useState<string | null>(null);
  const done = t.status === "done";
  return (
    <li className={cn("flex flex-wrap items-center gap-x-3 gap-y-1 py-2", pending && "opacity-60")}>
      <input
        type="checkbox"
        className="h-4 w-4"
        checked={done}
        disabled={pending}
        aria-label={done ? `Mark ${t.title} not done` : `Mark ${t.title} done`}
        onChange={(e) =>
          start(async () => {
            const r = await setTaskStatusAction(t.id, e.target.checked ? "done" : "todo");
            setErr(r.ok ? null : r.error);
          })
        }
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-1.5">
          <Link href={`/tasks/${t.id}`} className={cn("text-sm font-medium hover:underline", done && "text-muted line-through")}>
            {t.title}
          </Link>
          <PriorityBadge p={t.priority} />
          {t.status !== "todo" && !done ? <Badge tone={t.status === "blocked" ? "danger" : t.status === "in_progress" ? "accent" : "neutral"}>{TASK_STATUS_LABEL[t.status]}</Badge> : null}
          {t.overdue ? (
            <Badge tone="danger">
              <AlertTriangle size={11} /> overdue
            </Badge>
          ) : null}
          {t.recurring ? <Repeat size={12} className="text-muted" aria-label="Repeats" /> : null}
          {t.carryOverCount ? <Badge title="Times carried over">↻{t.carryOverCount}</Badge> : null}
        </div>
        <p className="mt-0.5 text-xs text-muted">
          {t.when ?? "Unscheduled"}
          {t.goalTitle ? ` · ${t.goalTitle}` : " · not linked to a goal"}
          {` · ${formatMinutes(t.actualMinutes)} / ${t.estimatedMinutes ? formatMinutes(t.estimatedMinutes) : "no estimate"}`}
        </p>
        {err ? <p className="text-xs text-danger">{err}</p> : null}
      </div>
      {!done ? (
        <div className="flex items-center gap-1">
          {showTimer ? <StartTimerButton taskId={t.id} /> : null}
          {tomorrow ? (
            <Button
              size="sm"
              variant="ghost"
              title="Move to tomorrow"
              aria-label={`Move ${t.title} to tomorrow`}
              onClick={() => start(async () => void (await carryOverAction([t.id], tomorrow)))}
            >
              <ArrowRightCircle size={15} />
            </Button>
          ) : null}
        </div>
      ) : null}
    </li>
  );
}

export function TaskListView({ items, tomorrow, empty }: { items: TaskItem[]; tomorrow?: string; empty?: React.ReactNode }) {
  if (!items.length) return <>{empty ?? <p className="py-3 text-sm text-muted">Nothing here.</p>}</>;
  return (
    <ul className="divide-y divide-border">
      {items.map((t) => (
        <TaskRow key={t.id} t={t} tomorrow={tomorrow} />
      ))}
    </ul>
  );
}

export function TaskBoard({ items }: { items: TaskItem[] }) {
  const [pending, start] = useTransition();
  const [dragId, setDragId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const router = useRouter();
  const move = (id: string, status: TaskStatus) =>
    start(async () => {
      const r = await setTaskStatusAction(id, status);
      setErr(r.ok ? null : r.error);
      router.refresh();
    });
  return (
    <div>
      {err ? (
        <p role="alert" className="mb-2 text-sm text-danger">
          {err}
        </p>
      ) : null}
      {/* Swipe between columns on phones and tablets; all five side by side when there is room. */}
      <div
        role="region"
        aria-label="Task board"
        tabIndex={0}
        className={cn("-mx-1 flex snap-x snap-mandatory gap-3 overflow-x-auto px-1 pb-2 @5xl:mx-0 @5xl:grid @5xl:grid-cols-5 @5xl:overflow-visible @5xl:px-0", pending && "opacity-70")}
      >
        {TASK_STATUSES.map((status) => {
          const col = items.filter((t) => t.status === status);
          return (
            <section
              key={status}
              aria-label={TASK_STATUS_LABEL[status]}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (dragId) move(dragId, status);
                setDragId(null);
              }}
              className="min-h-32 w-[min(16rem,80%)] shrink-0 snap-start rounded-xl border border-border bg-surface-2/60 p-2 @5xl:w-auto"
            >
              <h3 className="mb-2 flex items-center justify-between px-1 text-sm font-semibold">
                {TASK_STATUS_LABEL[status]} <span className="text-xs text-muted">{col.length}</span>
              </h3>
              <ul className="space-y-2">
                {col.map((t) => (
                  <li
                    key={t.id}
                    draggable
                    onDragStart={() => setDragId(t.id)}
                    className="cursor-grab rounded-lg border border-border bg-surface p-2 text-sm shadow-sm active:cursor-grabbing"
                  >
                    <Link href={`/tasks/${t.id}`} className="font-medium hover:underline">
                      {t.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap items-center gap-1 text-xs text-muted">
                      <PriorityBadge p={t.priority} />
                      {t.overdue ? <Badge tone="danger">overdue</Badge> : null}
                      <span>{t.when ?? "unscheduled"}</span>
                    </div>
                    {/* Keyboard / touch alternative to drag and drop */}
                    <Select
                      aria-label={`Move ${t.title} to column`}
                      className="mt-2 h-7 text-xs"
                      value={t.status}
                      onChange={(e) => move(t.id, e.target.value as TaskStatus)}
                    >
                      {TASK_STATUSES.map((s) => (
                        <option key={s} value={s}>
                          {TASK_STATUS_LABEL[s]}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            </section>
          );
        })}
      </div>
    </div>
  );
}

export function QuickAdd({ date, goals }: { date?: string; goals: GoalOption[] }) {
  return (
    <div className="@container">
    <ActionForm action={quickAddAction} resetOnSuccess className="grid grid-cols-2 items-start gap-2 @xl:grid-cols-[9.5rem_7rem_5.5rem_minmax(0,1fr)_auto] @5xl:grid-cols-[minmax(12rem,1fr)_10rem_7rem_5.5rem_11rem_auto]">
      <div className="col-span-2 @xl:col-span-full @5xl:col-span-1">
        <Input name="title" placeholder="Quick add a task…" aria-label="New task title" />
        <FieldError name="title" />
      </div>
      <Input name="date" type="date" defaultValue={date} aria-label="Date" />
      <Input name="time" type="time" aria-label="Start time (optional)" />
      <Input name="estimatedMinutes" type="number" min="1" placeholder="min" aria-label="Estimated minutes" />
      <Select name="goalId" aria-label="Goal" defaultValue="">
        <option value="">No goal</option>
        {goals.map((g) => (
          <option key={g.id} value={g.id}>
            {g.title}
          </option>
        ))}
      </Select>
      <SubmitButton pendingText="Adding…" className="col-span-2 @xl:col-span-1">
        <Plus size={16} /> Add
      </SubmitButton>
    </ActionForm>
    </div>
  );
}

export function NewTaskButton({
  goals,
  defaults,
  label = "New task",
  initiallyOpen = false,
}: {
  goals: GoalOption[];
  defaults?: Partial<TaskFormValues>;
  label?: string;
  initiallyOpen?: boolean;
}) {
  const [open, setOpen] = useState(initiallyOpen);
  const router = useRouter();
  return (
    <>
      <Button variant="primary" onClick={() => setOpen(true)}>
        <Plus size={16} /> {label}
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={label} wide>
        <TaskForm
          compact
          action={createTaskAction}
          goals={goals}
          defaults={emptyTask(defaults)}
          submitLabel="Create task"
          onSuccess={() => {
            setOpen(false);
            router.refresh();
          }}
        />
      </Dialog>
    </>
  );
}
