"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Pencil, Trash2, X } from "lucide-react";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Badge, Button, Field, Input, Select } from "@/components/ui";
import { ConfirmButton, Dialog } from "@/components/ui/dialog";
import { TASK_STATUS_LABEL, type TaskStatus } from "@/lib/constants";
import {
  addChecklistAction,
  addDependencyAction,
  deleteChecklistAction,
  deleteTaskAction,
  removeDependencyAction,
  toggleChecklistAction,
} from "@/server/actions/tasks";
import { deleteSessionAction, saveSessionAction } from "@/server/actions/timer";

export function Checklist({ taskId, items }: { taskId: string; items: { id: string; title: string; done: boolean }[] }) {
  const [pending, start] = useTransition();
  const done = items.filter((i) => i.done).length;
  return (
    <div>
      {items.length ? (
        <p className="mb-2 text-xs text-muted">
          {done} of {items.length} done
        </p>
      ) : null}
      <ul className="space-y-1">
        {items.map((i) => (
          <li key={i.id} className="group flex items-center gap-2">
            <input
              type="checkbox"
              checked={i.done}
              disabled={pending}
              onChange={(e) => start(() => toggleChecklistAction(i.id, e.target.checked))}
              aria-label={i.title}
            />
            <span className={i.done ? "flex-1 text-sm text-muted line-through" : "flex-1 text-sm"}>{i.title}</span>
            <button type="button" className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove ${i.title}`} onClick={() => start(() => deleteChecklistAction(i.id))}>
              <X size={14} />
            </button>
          </li>
        ))}
      </ul>
      <ActionForm action={addChecklistAction.bind(null, taskId)} resetOnSuccess showMessage={false} className="mt-2 flex gap-2">
        <Input name="title" placeholder="Add checklist item" aria-label="New checklist item" className="h-8" />
        <SubmitButton size="sm" variant="secondary" pendingText="…">
          Add
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

export function Dependencies({
  taskId,
  deps,
  candidates,
}: {
  taskId: string;
  deps: { id: string; title: string; status: TaskStatus }[];
  candidates: { id: string; title: string }[];
}) {
  const [pending, start] = useTransition();
  return (
    <div>
      {deps.length ? (
        <ul className="mb-2 space-y-1">
          {deps.map((d) => (
            <li key={d.id} className="flex items-center gap-2 text-sm">
              <Link href={`/tasks/${d.id}`} className="flex-1 hover:underline">
                {d.title}
              </Link>
              <Badge tone={d.status === "done" ? "ok" : "warn"}>{TASK_STATUS_LABEL[d.status]}</Badge>
              <button type="button" disabled={pending} className="rounded p-1 text-muted hover:text-danger" aria-label={`Remove dependency ${d.title}`} onClick={() => start(() => removeDependencyAction(taskId, d.id))}>
                <X size={14} />
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-muted">No dependencies.</p>
      )}
      <ActionForm action={addDependencyAction.bind(null, taskId)} resetOnSuccess className="flex gap-2">
        <Select name="dependsOn" aria-label="Blocked by task" className="h-8" defaultValue="">
          <option value="" disabled>
            Blocked by…
          </option>
          {candidates.map((c) => (
            <option key={c.id} value={c.id}>
              {c.title}
            </option>
          ))}
        </Select>
        <SubmitButton size="sm" variant="secondary" pendingText="…">
          Add
        </SubmitButton>
      </ActionForm>
    </div>
  );
}

export function DeleteTask({ id, title }: { id: string; title: string }) {
  const router = useRouter();
  return (
    <ConfirmButton
      title={`Delete "${title}"?`}
      description="This removes the task, its checklist and reminders. Recorded work sessions are kept but unlinked."
      onConfirm={async () => {
        await deleteTaskAction(id);
        router.push("/tasks");
      }}
    >
      <Trash2 size={14} /> Delete
    </ConfirmButton>
  );
}

export type SessionRow = {
  id: string;
  kind: "focus" | "break";
  source: string;
  start: string;
  end: string;
  startLabel: string;
  endLabel: string | null;
  minutes: number;
  note: string;
  taskId: string | null;
  taskTitle?: string | null;
};

export function SessionEditor({
  taskId,
  defaults,
  onDone,
  tasks,
}: {
  taskId: string | null;
  defaults?: SessionRow;
  onDone?: () => void;
  /** When given, the user picks the task instead of it being fixed. */
  tasks?: { id: string; title: string }[];
}) {
  return (
    <ActionForm action={saveSessionAction} resetOnSuccess={!defaults} onSuccess={onDone} className="grid gap-2 sm:grid-cols-[1fr_1fr_7rem] sm:items-end">
      {defaults ? <input type="hidden" name="id" value={defaults.id} /> : null}
      {tasks ? (
        <Field label="Task" htmlFor={`s-task-${defaults?.id ?? "new"}`} className="sm:col-span-3">
          <Select id={`s-task-${defaults?.id ?? "new"}`} name="taskId" defaultValue={taskId ?? ""}>
            <option value="">No task</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        </Field>
      ) : (
        <input type="hidden" name="taskId" value={taskId ?? ""} />
      )}
      <Field label="Start" htmlFor={`s-start-${defaults?.id ?? "new"}`}>
        <Input id={`s-start-${defaults?.id ?? "new"}`} name="start" type="datetime-local" defaultValue={defaults?.start} />
        <FieldError name="start" />
      </Field>
      <Field label="End" htmlFor={`s-end-${defaults?.id ?? "new"}`}>
        <Input id={`s-end-${defaults?.id ?? "new"}`} name="end" type="datetime-local" defaultValue={defaults?.end} />
        <FieldError name="end" />
      </Field>
      <Field label="Type" htmlFor={`s-kind-${defaults?.id ?? "new"}`}>
        <Select id={`s-kind-${defaults?.id ?? "new"}`} name="kind" defaultValue={defaults?.kind ?? "focus"}>
          <option value="focus">Focus</option>
          <option value="break">Break</option>
        </Select>
      </Field>
      <Field label="Note" htmlFor={`s-note-${defaults?.id ?? "new"}`} className="sm:col-span-2">
        <Input id={`s-note-${defaults?.id ?? "new"}`} name="note" defaultValue={defaults?.note} />
      </Field>
      <SubmitButton variant="secondary">{defaults ? "Save correction" : "Add time"}</SubmitButton>
    </ActionForm>
  );
}

export function SessionList({ rows, showTask }: { rows: SessionRow[]; showTask?: boolean }) {
  const [editing, setEditing] = useState<SessionRow | null>(null);
  const [pending, start] = useTransition();
  if (!rows.length) return <p className="text-sm text-muted">No time recorded yet.</p>;
  return (
    <>
      <ul className="divide-y divide-border">
        {rows.map((r) => (
          <li key={r.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
            <Badge tone={r.kind === "break" ? "info" : "accent"}>{r.kind}</Badge>
            <span className="tabular-nums">
              {r.startLabel} – {r.endLabel ?? "running"}
            </span>
            <span className="font-medium tabular-nums">{r.minutes}m</span>
            {r.source !== "timer" ? <Badge>{r.source}</Badge> : null}
            {showTask && r.taskTitle ? (
              <Link className="text-muted hover:underline" href={`/tasks/${r.taskId}`}>
                {r.taskTitle}
              </Link>
            ) : null}
            {r.note ? <span className="w-full text-xs text-muted sm:w-auto sm:flex-1">“{r.note}”</span> : <span className="flex-1" />}
            {r.endLabel ? (
              <Button size="sm" variant="ghost" onClick={() => setEditing(r)} aria-label="Correct session">
                <Pencil size={13} />
              </Button>
            ) : null}
            <Button size="sm" variant="ghost" disabled={pending} onClick={() => start(() => deleteSessionAction(r.id))} aria-label="Delete session">
              <Trash2 size={13} />
            </Button>
          </li>
        ))}
      </ul>
      <Dialog open={editing !== null} onClose={() => setEditing(null)} title="Correct session">
        {editing ? <SessionEditor taskId={editing.taskId} defaults={editing} onDone={() => setEditing(null)} /> : null}
      </Dialog>
    </>
  );
}
