"use client";

import { useState, useTransition } from "react";
import { Trash2 } from "lucide-react";
import { CartesianGrid, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button, Select } from "@/components/ui";
import { ConfirmButton, Dialog } from "@/components/ui/dialog";
import { GOAL_STATUSES } from "@/lib/constants";
import { titleCase } from "@/lib/format";
import { deleteGoalAction, deleteMilestoneAction, setGoalStatusAction, toggleMilestoneAction } from "@/server/actions/goals";

export function MilestoneList({ items }: { items: { id: string; title: string; weight: number; dueDate: string | null; done: boolean }[] }) {
  const [pending, start] = useTransition();
  const total = items.reduce((s, m) => s + m.weight, 0);
  if (!items.length) return <p className="text-sm text-muted">No milestones yet.</p>;
  return (
    <ul className="divide-y divide-border">
      {items.map((m) => (
        <li key={m.id} className="flex items-center gap-3 py-2">
          <input
            type="checkbox"
            checked={m.done}
            disabled={pending}
            onChange={(e) => start(() => toggleMilestoneAction(m.id, e.target.checked))}
            aria-label={`Mark ${m.title} ${m.done ? "not done" : "done"}`}
            className="h-4 w-4"
          />
          <div className="min-w-0 flex-1">
            <p className={m.done ? "text-sm text-muted line-through" : "text-sm"}>{m.title}</p>
            <p className="text-xs text-muted">
              Weight {m.weight} ({total ? Math.round((m.weight / total) * 100) : 0}%){m.dueDate ? ` · due ${m.dueDate}` : ""}
            </p>
          </div>
          <ConfirmButton title={`Delete milestone "${m.title}"?`} onConfirm={() => deleteMilestoneAction(m.id)}>
            <Trash2 size={14} aria-label="Delete milestone" />
          </ConfirmButton>
        </li>
      ))}
    </ul>
  );
}

export function GoalStatusSelect({ id, status }: { id: string; status: string }) {
  const [pending, start] = useTransition();
  return (
    <Select
      aria-label="Goal status"
      className="h-8 w-auto text-sm"
      defaultValue={status}
      disabled={pending}
      onChange={(e) => start(() => setGoalStatusAction(id, e.target.value))}
    >
      {GOAL_STATUSES.map((s) => (
        <option key={s} value={s}>
          {titleCase(s)}
        </option>
      ))}
    </Select>
  );
}

export function DeleteGoalButton({ id, title, childCount }: { id: string; title: string; childCount: number }) {
  const [open, setOpen] = useState(false);
  const [mode, setMode] = useState<"reparent" | "cascade">("reparent");
  const [pending, start] = useTransition();
  return (
    <>
      <Button size="sm" variant="ghost" onClick={() => setOpen(true)} className="text-danger">
        <Trash2 size={14} /> Delete
      </Button>
      <Dialog open={open} onClose={() => setOpen(false)} title={`Delete "${title}"?`}>
        <p className="text-sm text-muted">Linked tasks are never deleted; they stay in your task list.</p>
        {childCount > 0 ? (
          <fieldset className="mt-3 space-y-2 text-sm">
            <legend className="mb-1 font-medium">This goal has {childCount} child goal(s).</legend>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === "reparent"} onChange={() => setMode("reparent")} />
              Keep child goals and move them up one level
            </label>
            <label className="flex items-start gap-2">
              <input type="radio" name="mode" checked={mode === "cascade"} onChange={() => setMode("cascade")} />
              Delete the whole branch (all descendants)
            </label>
          </fieldset>
        ) : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button onClick={() => setOpen(false)}>Cancel</Button>
          <Button variant="danger" disabled={pending} onClick={() => start(() => deleteGoalAction(id, mode))}>
            {pending ? "Deleting…" : "Delete goal"}
          </Button>
        </div>
      </Dialog>
    </>
  );
}

export function ProgressChart({ points, unit }: { points: { at: string; pct: number; value: number | null }[]; unit: string }) {
  if (points.length < 2) return <p className="text-sm text-muted">Progress history appears after you record progress a few times.</p>;
  return (
    <div className="h-48 w-full" role="img" aria-label="Progress over time">
      <ResponsiveContainer>
        <LineChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: -16 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" />
          <XAxis dataKey="at" tick={{ fontSize: 11, fill: "var(--muted)" }} />
          <YAxis domain={[0, 100]} tick={{ fontSize: 11, fill: "var(--muted)" }} unit="%" />
          <Tooltip
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12 }}
            formatter={(v, _n, item) => {
              const val = (item?.payload as { value: number | null } | undefined)?.value;
              return [`${v}%${val !== null && val !== undefined ? ` (${val} ${unit})` : ""}`, "Progress"];
            }}
          />
          <Line type="monotone" dataKey="pct" stroke="var(--accent)" strokeWidth={2} dot={{ r: 2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
