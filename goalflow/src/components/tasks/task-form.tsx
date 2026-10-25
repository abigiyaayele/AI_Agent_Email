"use client";

import { useState } from "react";
import { ActionForm, FieldError, SubmitButton, useFormResult } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import { PRIORITIES, TASK_STATUS_LABEL, TASK_STATUSES } from "@/lib/constants";
import { titleCase, WEEKDAYS } from "@/lib/format";
import type { ActionResult } from "@/lib/validation/common";

export type TaskFormValues = {
  title: string;
  description: string;
  notes: string;
  status: string;
  priority: string;
  goalId: string;
  milestoneId: string;
  parentTaskId: string;
  scheduledStart: string;
  durationMinutes: string;
  dueAt: string;
  estimatedMinutes: string;
  remainingMinutes: string;
  allowOverlap: boolean;
  startReminder: string;
  deadlineReminder: string;
  recurrenceFreq: string;
  recurrenceInterval: string;
  recurrenceDays: number[];
  recurrenceUntil: string;
};

export const emptyTask = (over: Partial<TaskFormValues> = {}): TaskFormValues => ({
  title: "",
  description: "",
  notes: "",
  status: "todo",
  priority: "medium",
  goalId: "",
  milestoneId: "",
  parentTaskId: "",
  scheduledStart: "",
  durationMinutes: "",
  dueAt: "",
  estimatedMinutes: "",
  remainingMinutes: "",
  allowOverlap: false,
  startReminder: "none",
  deadlineReminder: "none",
  recurrenceFreq: "none",
  recurrenceInterval: "1",
  recurrenceDays: [],
  recurrenceUntil: "",
  ...over,
});

export type GoalOption = { id: string; title: string; level: string; milestones: { id: string; title: string }[] };

const OFFSETS = [
  ["none", "No reminder"],
  ["0", "At the time"],
  ["5", "5 min before"],
  ["10", "10 min before"],
  ["15", "15 min before"],
  ["30", "30 min before"],
  ["60", "1 hour before"],
  ["1440", "1 day before"],
];

function OverlapHint() {
  const res = useFormResult();
  if (!res || res.ok || !res.conflicts?.length) return null;
  return <p className="text-xs text-warn">Tick “Allow overlap” below if you really want both at the same time.</p>;
}

export function TaskForm({
  action,
  defaults,
  goals,
  submitLabel,
  onSuccess,
  compact,
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult | null>;
  defaults: TaskFormValues;
  goals: GoalOption[];
  submitLabel: string;
  onSuccess?: () => void;
  compact?: boolean;
}) {
  const [goalId, setGoalId] = useState(defaults.goalId);
  const [freq, setFreq] = useState(defaults.recurrenceFreq);
  const milestones = goals.find((g) => g.id === goalId)?.milestones ?? [];
  return (
    <ActionForm action={action} className="space-y-4" onSuccess={onSuccess}>
      <input type="hidden" name="parentTaskId" value={defaults.parentTaskId} />
      <Field label="Title" htmlFor="t-title">
        <Input id="t-title" name="title" defaultValue={defaults.title} required autoFocus={compact} />
        <FieldError name="title" />
      </Field>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Status" htmlFor="t-status">
          <Select id="t-status" name="status" defaultValue={defaults.status}>
            {TASK_STATUSES.map((s) => (
              <option key={s} value={s}>
                {TASK_STATUS_LABEL[s]}
              </option>
            ))}
          </Select>
          <FieldError name="status" />
        </Field>
        <Field label="Priority" htmlFor="t-priority">
          <Select id="t-priority" name="priority" defaultValue={defaults.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Estimated minutes" htmlFor="t-est">
          <Input id="t-est" name="estimatedMinutes" type="number" min="1" defaultValue={defaults.estimatedMinutes} />
          <FieldError name="estimatedMinutes" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Goal" htmlFor="t-goal" hint="Every task should serve a goal.">
          <Select id="t-goal" name="goalId" value={goalId} onChange={(e) => setGoalId(e.target.value)}>
            <option value="">Not linked yet</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title} ({g.level})
              </option>
            ))}
          </Select>
          <FieldError name="goalId" />
        </Field>
        <Field label="Milestone" htmlFor="t-ms">
          <Select id="t-ms" name="milestoneId" defaultValue={defaults.milestoneId} disabled={!milestones.length}>
            <option value="">{milestones.length ? "None" : "No milestones on this goal"}</option>
            {milestones.map((m) => (
              <option key={m.id} value={m.id}>
                {m.title}
              </option>
            ))}
          </Select>
          <FieldError name="milestoneId" />
        </Field>
      </div>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Start" htmlFor="t-start">
          <Input id="t-start" name="scheduledStart" type="datetime-local" defaultValue={defaults.scheduledStart} />
          <FieldError name="scheduledStart" />
        </Field>
        <Field label="Duration (min)" htmlFor="t-dur" hint="Defaults to the estimate.">
          <Input id="t-dur" name="durationMinutes" type="number" min="5" defaultValue={defaults.durationMinutes} />
          <FieldError name="durationMinutes" />
        </Field>
        <Field label="Deadline" htmlFor="t-due">
          <Input id="t-due" name="dueAt" type="datetime-local" defaultValue={defaults.dueAt} />
          <FieldError name="dueAt" />
        </Field>
      </div>
      <OverlapHint />
      <label className="flex items-center gap-2 text-sm">
        <input type="checkbox" name="allowOverlap" defaultChecked={defaults.allowOverlap} />
        Allow overlap with other scheduled items
      </label>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Start reminder" htmlFor="t-sr">
          <Select id="t-sr" name="startReminder" defaultValue={defaults.startReminder}>
            {OFFSETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <FieldError name="startReminder" />
        </Field>
        <Field label="Deadline reminder" htmlFor="t-dr">
          <Select id="t-dr" name="deadlineReminder" defaultValue={defaults.deadlineReminder}>
            {OFFSETS.map(([v, l]) => (
              <option key={v} value={v}>
                {l}
              </option>
            ))}
          </Select>
          <FieldError name="deadlineReminder" />
        </Field>
        <Field label="Remaining minutes" htmlFor="t-rem" hint="Optional override.">
          <Input id="t-rem" name="remainingMinutes" type="number" min="0" defaultValue={defaults.remainingMinutes} />
        </Field>
      </div>
      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">Repeat</legend>
        <div className="grid gap-3 sm:grid-cols-3">
          <Select name="recurrenceFreq" value={freq} onChange={(e) => setFreq(e.target.value)} aria-label="Repeat frequency">
            <option value="none">Does not repeat</option>
            <option value="daily">Daily</option>
            <option value="weekly">Weekly</option>
            <option value="monthly">Monthly</option>
            <option value="yearly">Yearly</option>
          </Select>
          {freq !== "none" ? (
            <>
              <label className="flex items-center gap-2 text-sm">
                every
                <Input name="recurrenceInterval" type="number" min="1" max="52" defaultValue={defaults.recurrenceInterval} className="w-20" />
                {freq === "daily" ? "days" : freq === "weekly" ? "weeks" : freq === "monthly" ? "months" : "years"}
              </label>
              <label className="flex items-center gap-2 text-sm">
                until
                <Input name="recurrenceUntil" type="date" defaultValue={defaults.recurrenceUntil} />
              </label>
            </>
          ) : null}
        </div>
        {freq === "weekly" ? (
          <div className="mt-2 flex flex-wrap gap-1.5">
            {WEEKDAYS.map((d) => (
              <label key={d.value} className="flex items-center gap-1 rounded-lg border border-border px-2 py-1 text-sm has-[:checked]:border-accent has-[:checked]:bg-accent-soft">
                <input type="checkbox" name="recurrenceDays[]" value={d.value} defaultChecked={defaults.recurrenceDays.includes(d.value)} />
                {d.short}
              </label>
            ))}
          </div>
        ) : null}
        <FieldError name="recurrenceInterval" />
      </fieldset>
      <Field label="Description" htmlFor="t-desc">
        <Textarea id="t-desc" name="description" rows={compact ? 2 : 3} defaultValue={defaults.description} />
      </Field>
      {!compact ? (
        <Field label="Notes" htmlFor="t-notes">
          <Textarea id="t-notes" name="notes" rows={4} defaultValue={defaults.notes} />
        </Field>
      ) : (
        <input type="hidden" name="notes" value={defaults.notes} />
      )}
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
