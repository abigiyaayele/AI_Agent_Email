"use client";

import { useMemo, useState } from "react";
import { ActionForm, FieldError, SubmitButton } from "@/components/ui/action-form";
import { Field, Input, Select, Textarea } from "@/components/ui";
import {
  GOAL_CATEGORIES,
  GOAL_LEVEL_LABEL,
  GOAL_LEVELS,
  GOAL_STATUSES,
  METRIC_TYPE_LABEL,
  METRIC_TYPES,
  PRIORITIES,
  type GoalLevel,
  type MetricType,
} from "@/lib/constants";
import { titleCase } from "@/lib/format";
import type { ActionResult } from "@/lib/validation/common";

export type GoalFormValues = {
  title: string;
  description: string;
  level: GoalLevel;
  parentId: string | null;
  category: string;
  startDate: string;
  targetDate: string;
  metricType: MetricType;
  unit: string;
  direction: "increase" | "decrease";
  startValue: number;
  targetValue: number | null;
  currentValue: number;
  priority: string;
  status: string;
  estimatedHours: number | null;
  weight: number;
};

export type ParentOption = { id: string; title: string; level: GoalLevel; startDate: string; targetDate: string };

const RANK: Record<GoalLevel, number> = { year: 0, half: 1, quarter: 2, month: 3, week: 4 };

export function GoalForm({
  action,
  defaults,
  parents,
  submitLabel,
  excludeIds = [],
}: {
  action: (prev: unknown, fd: FormData) => Promise<ActionResult | null>;
  defaults: GoalFormValues;
  parents: ParentOption[];
  submitLabel: string;
  excludeIds?: string[];
}) {
  const [level, setLevel] = useState<GoalLevel>(defaults.level);
  const [metric, setMetric] = useState<MetricType>(defaults.metricType);
  const [parentId, setParentId] = useState(defaults.parentId ?? "");
  const validParents = useMemo(
    () => parents.filter((p) => RANK[p.level] < RANK[level] && !excludeIds.includes(p.id)),
    [parents, level, excludeIds],
  );
  const parent = parents.find((p) => p.id === parentId);

  return (
    <ActionForm action={action} className="space-y-4">
      <Field label="Name" htmlFor="title">
        <Input id="title" name="title" defaultValue={defaults.title} required placeholder="e.g. Read 24 books this year" />
        <FieldError name="title" />
      </Field>
      <Field label="Description" htmlFor="description">
        <Textarea id="description" name="description" rows={2} defaultValue={defaults.description} />
      </Field>
      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Horizon" htmlFor="level">
          <Select id="level" name="level" value={level} onChange={(e) => setLevel(e.target.value as GoalLevel)}>
            {GOAL_LEVELS.map((l) => (
              <option key={l} value={l}>
                {GOAL_LEVEL_LABEL[l]}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Parent goal" htmlFor="parentId" hint={parent ? `Window: ${parent.startDate} – ${parent.targetDate}` : "Optional. Link to a larger goal."}>
          <Select id="parentId" name="parentId" value={parentId} onChange={(e) => setParentId(e.target.value)}>
            <option value="">None (top level)</option>
            {validParents.map((p) => (
              <option key={p.id} value={p.id}>
                {GOAL_LEVEL_LABEL[p.level]}: {p.title}
              </option>
            ))}
          </Select>
          <FieldError name="parentId" />
        </Field>
        <Field label="Category" htmlFor="category">
          <Select id="category" name="category" defaultValue={defaults.category}>
            {GOAL_CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {titleCase(c)}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Start date" htmlFor="startDate">
          <Input id="startDate" name="startDate" type="date" defaultValue={defaults.startDate} />
          <FieldError name="startDate" />
        </Field>
        <Field label="Target date" htmlFor="targetDate">
          <Input id="targetDate" name="targetDate" type="date" defaultValue={defaults.targetDate} />
          <FieldError name="targetDate" />
        </Field>
        <Field label="Priority" htmlFor="priority">
          <Select id="priority" name="priority" defaultValue={defaults.priority}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>

      <fieldset className="rounded-lg border border-border p-3">
        <legend className="px-1 text-sm font-medium">How is progress measured?</legend>
        <Select name="metricType" value={metric} onChange={(e) => setMetric(e.target.value as MetricType)} aria-label="Progress method">
          {METRIC_TYPES.map((m) => (
            <option key={m} value={m}>
              {METRIC_TYPE_LABEL[m]}
            </option>
          ))}
        </Select>
        {metric === "numeric" ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-5">
            <Field label="Unit" htmlFor="unit">
              <Input id="unit" name="unit" defaultValue={defaults.unit} placeholder="books, kg, $" />
            </Field>
            <Field label="Better when" htmlFor="direction">
              <Select id="direction" name="direction" defaultValue={defaults.direction}>
                <option value="increase">Higher</option>
                <option value="decrease">Lower</option>
              </Select>
              <FieldError name="direction" />
            </Field>
            <Field label="Start value" htmlFor="startValue">
              <Input id="startValue" name="startValue" type="number" step="any" defaultValue={defaults.startValue} />
            </Field>
            <Field label="Target value" htmlFor="targetValue">
              <Input id="targetValue" name="targetValue" type="number" step="any" defaultValue={defaults.targetValue ?? ""} />
              <FieldError name="targetValue" />
            </Field>
            <Field label="Current value" htmlFor="currentValue">
              <Input id="currentValue" name="currentValue" type="number" step="any" defaultValue={defaults.currentValue} />
            </Field>
          </div>
        ) : (
          <>
            <input type="hidden" name="unit" value={defaults.unit} />
            <input type="hidden" name="direction" value={defaults.direction} />
            <input type="hidden" name="startValue" value={defaults.startValue} />
            <input type="hidden" name="targetValue" value={defaults.targetValue ?? ""} />
            <input type="hidden" name="currentValue" value={defaults.currentValue} />
            <p className="mt-2 text-xs text-muted">
              {metric === "milestones" && "Progress = completed milestone weight ÷ total weight. Add milestones on the goal page."}
              {metric === "children" && "Progress = weighted average of child goals (set each child's weight)."}
              {metric === "tasks" && "Progress = done task effort ÷ total task effort (unestimated tasks count as 30 min)."}
            </p>
          </>
        )}
      </fieldset>

      <div className="grid gap-4 sm:grid-cols-3">
        <Field label="Estimated total effort (hours)" htmlFor="estimatedHours" hint="Used for required pace per day.">
          <Input id="estimatedHours" name="estimatedHours" type="number" step="0.5" min="0" defaultValue={defaults.estimatedHours ?? ""} />
          <FieldError name="estimatedHours" />
        </Field>
        <Field label="Weight in parent" htmlFor="weight" hint="Relative importance when rolling up.">
          <Input id="weight" name="weight" type="number" step="0.1" min="0" defaultValue={defaults.weight} />
          <FieldError name="weight" />
        </Field>
        <Field label="Status" htmlFor="status">
          <Select id="status" name="status" defaultValue={defaults.status}>
            {GOAL_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <SubmitButton>{submitLabel}</SubmitButton>
    </ActionForm>
  );
}
