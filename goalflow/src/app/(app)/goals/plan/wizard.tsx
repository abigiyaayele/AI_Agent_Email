"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Plus, Sparkles, Trash2 } from "lucide-react";
import { Badge, Button, Card, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { GOAL_CATEGORIES, GOAL_LEVEL_LABEL, PRIORITIES, type GoalCategory } from "@/lib/constants";
import type { DraftGoal, DraftPlan, DraftTask } from "@/lib/domain/breakdown";
import { titleCase } from "@/lib/format";
import { applyPlanAction, draftPlanAction } from "@/server/actions/goals";

const STEPS = ["Outcome", "Measure", "Milestones", "Effort", "Review"] as const;

type Form = {
  title: string;
  description: string;
  category: GoalCategory;
  outcome: string;
  unit: string;
  direction: "increase" | "decrease";
  startValue: string;
  targetValue: string;
  startDate: string;
  targetDate: string;
  estimatedHours: string;
  milestones: { title: string; weight: string }[];
  sessionsPerWeek: string;
  sessionMinutes: string;
  dailyAction: string;
  weeksForMonths: string;
  useAi: boolean;
};

type EditableGoal = DraftGoal & { include: boolean };
type EditableTask = DraftTask & { include: boolean };

export function PlanWizard({ today, yearEnd, aiEnabled }: { today: string; yearEnd: string; aiEnabled: boolean }) {
  const router = useRouter();
  const [step, setStep] = useState(0);
  const [pending, start] = useTransition();
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const [form, setForm] = useState<Form>({
    title: "",
    description: "",
    category: "personal",
    outcome: "",
    unit: "",
    direction: "increase",
    startValue: "0",
    targetValue: "",
    startDate: today,
    targetDate: yearEnd,
    estimatedHours: "",
    milestones: [],
    sessionsPerWeek: "4",
    sessionMinutes: "45",
    dailyAction: "",
    weeksForMonths: "1",
    useAi: aiEnabled,
  });
  const [plan, setPlan] = useState<{ goals: EditableGoal[]; tasks: EditableTask[]; milestones: DraftPlan["milestones"]; workload: DraftPlan["workload"]; source: string; notes: string[] } | null>(null);

  const set = <K extends keyof Form>(k: K, v: Form[K]) => setForm((f) => ({ ...f, [k]: v }));
  const err = (k: string) => (errors[k] ? <p className="mt-1 text-xs text-danger">{errors[k]}</p> : null);

  function stepValid(): boolean {
    const e: Record<string, string> = {};
    if (step === 0) {
      if (!form.title.trim()) e.title = "Name your goal";
      if (!form.outcome.trim()) e.outcome = "Describe the outcome";
    }
    if (step === 1) {
      if (!form.unit.trim()) e.unit = "What will you measure?";
      if (form.targetValue === "") e.targetValue = "Set a target";
      if (form.targetDate <= form.startDate) e.targetDate = "Target date must be after the start";
    }
    if (step === 3 && !(Number(form.estimatedHours) > 0)) e.estimatedHours = "Estimate the total hours";
    setErrors(e);
    return Object.keys(e).length === 0;
  }

  function generate() {
    if (!stepValid()) return;
    setError(null);
    start(async () => {
      const res = await draftPlanAction({
        ...form,
        milestones: form.milestones.filter((m) => m.title.trim()).map((m) => ({ title: m.title, weight: Number(m.weight) || 1 })),
      });
      if (!res.ok) {
        setError(res.error);
        setErrors(res.fieldErrors ?? {});
        return;
      }
      const d = res.data!;
      setPlan({
        goals: d.plan.goals.map((g) => ({ ...g, include: true })),
        tasks: d.plan.tasks.map((t) => ({ ...t, include: true })),
        milestones: d.plan.milestones,
        workload: d.plan.workload,
        source: d.source,
        notes: d.notes,
      });
      setStep(4);
    });
  }

  function approve() {
    if (!plan) return;
    setError(null);
    start(async () => {
      const res = await applyPlanAction({
        category: form.category,
        description: [form.outcome, form.description].filter(Boolean).join("\n\n"),
        goals: plan.goals.map(({ key, parentKey, level, title, startDate, targetDate, startValue, targetValue, unit, direction, estimatedHours, include }) => ({
          key,
          parentKey,
          level,
          title,
          startDate,
          targetDate,
          startValue,
          targetValue,
          unit,
          direction,
          estimatedHours,
          include,
        })),
        milestones: plan.milestones,
        tasks: plan.tasks,
      });
      if (!res.ok) {
        setError(res.error);
        return;
      }
      router.push(`/goals/${res.data!.rootId}`);
    });
  }

  const toggleGoal = (key: string, include: boolean) =>
    setPlan((p) => {
      if (!p) return p;
      // Excluding a goal excludes its descendants; including one includes its ancestors.
      const desc = new Set<string>([key]);
      let grew = true;
      while (grew) {
        grew = false;
        for (const g of p.goals) if (g.parentKey && desc.has(g.parentKey) && !desc.has(g.key)) (desc.add(g.key), (grew = true));
      }
      const anc = new Set<string>();
      let cur = p.goals.find((g) => g.key === key)?.parentKey;
      while (cur) {
        anc.add(cur);
        cur = p.goals.find((g) => g.key === cur)?.parentKey ?? null;
      }
      return {
        ...p,
        goals: p.goals.map((g) => (include ? (g.key === key || anc.has(g.key) ? { ...g, include: true } : g) : desc.has(g.key) ? { ...g, include: false } : g)),
        tasks: include ? p.tasks : p.tasks.map((t) => (desc.has(t.goalKey) ? { ...t, include: false } : t)),
      };
    });

  return (
    <div className="space-y-4">
      <ol className="flex flex-wrap gap-1.5 text-sm" aria-label="Steps">
        {STEPS.map((s, i) => (
          <li key={s}>
            <button
              type="button"
              disabled={i > step || pending}
              onClick={() => setStep(i)}
              aria-current={i === step ? "step" : undefined}
              className={cn(
                "rounded-full border px-3 py-1",
                i === step ? "border-accent bg-accent text-accent-fg" : i < step ? "border-accent text-accent" : "border-border text-muted",
              )}
            >
              {i + 1}. {s}
            </button>
          </li>
        ))}
      </ol>

      {step === 0 ? (
        <Card className="space-y-4">
          <h2 className="font-semibold">1. Define the desired outcome</h2>
          <Field label="Goal name" htmlFor="w-title">
            <Input id="w-title" value={form.title} onChange={(e) => set("title", e.target.value)} placeholder="e.g. Read 24 books in 2027" />
            {err("title")}
          </Field>
          <Field label="What does success look like?" htmlFor="w-outcome" hint="Be concrete: what will be true when you're done?">
            <Textarea id="w-outcome" rows={2} value={form.outcome} onChange={(e) => set("outcome", e.target.value)} />
            {err("outcome")}
          </Field>
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Category" htmlFor="w-cat">
              <Select id="w-cat" value={form.category} onChange={(e) => set("category", e.target.value as GoalCategory)}>
                {GOAL_CATEGORIES.map((c) => (
                  <option key={c} value={c}>
                    {titleCase(c)}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Why it matters (optional)" htmlFor="w-desc">
              <Input id="w-desc" value={form.description} onChange={(e) => set("description", e.target.value)} />
            </Field>
          </div>
        </Card>
      ) : null}

      {step === 1 ? (
        <Card className="space-y-4">
          <h2 className="font-semibold">2. Make it measurable</h2>
          <div className="grid gap-4 sm:grid-cols-4">
            <Field label="Unit" htmlFor="w-unit" hint="books, km, $, kg, chapters…">
              <Input id="w-unit" value={form.unit} onChange={(e) => set("unit", e.target.value)} />
              {err("unit")}
            </Field>
            <Field label="Better when" htmlFor="w-dir">
              <Select id="w-dir" value={form.direction} onChange={(e) => set("direction", e.target.value as "increase" | "decrease")}>
                <option value="increase">Higher (grow)</option>
                <option value="decrease">Lower (reduce)</option>
              </Select>
              {err("direction")}
            </Field>
            <Field label="Starting value" htmlFor="w-sv">
              <Input id="w-sv" type="number" step="any" value={form.startValue} onChange={(e) => set("startValue", e.target.value)} />
            </Field>
            <Field label="Target value" htmlFor="w-tv">
              <Input id="w-tv" type="number" step="any" value={form.targetValue} onChange={(e) => set("targetValue", e.target.value)} />
              {err("targetValue")}
            </Field>
            <Field label="Start date" htmlFor="w-sd">
              <Input id="w-sd" type="date" value={form.startDate} onChange={(e) => set("startDate", e.target.value)} />
            </Field>
            <Field label="Target date" htmlFor="w-td">
              <Input id="w-td" type="date" value={form.targetDate} onChange={(e) => set("targetDate", e.target.value)} />
              {err("targetDate")}
            </Field>
          </div>
        </Card>
      ) : null}

      {step === 2 ? (
        <Card className="space-y-3">
          <h2 className="font-semibold">3. Identify measurable milestones</h2>
          <p className="text-sm text-muted">Optional. Weights express importance; they don&apos;t need to add up to 100.{aiEnabled ? " The AI can suggest milestones too." : ""}</p>
          {form.milestones.map((m, i) => (
            <div key={i} className="flex items-end gap-2">
              <Field label={`Milestone ${i + 1}`} htmlFor={`ms-${i}`} className="flex-1">
                <Input
                  id={`ms-${i}`}
                  value={m.title}
                  onChange={(e) => set("milestones", form.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                />
              </Field>
              <Field label="Weight" htmlFor={`msw-${i}`} className="w-24">
                <Input
                  id={`msw-${i}`}
                  type="number"
                  min="0.1"
                  step="0.1"
                  value={m.weight}
                  onChange={(e) => set("milestones", form.milestones.map((x, j) => (j === i ? { ...x, weight: e.target.value } : x)))}
                />
              </Field>
              <Button size="md" variant="ghost" aria-label="Remove milestone" onClick={() => set("milestones", form.milestones.filter((_, j) => j !== i))}>
                <Trash2 size={16} />
              </Button>
            </div>
          ))}
          <Button size="sm" onClick={() => set("milestones", [...form.milestones, { title: "", weight: "1" }])}>
            <Plus size={14} /> Add milestone
          </Button>
        </Card>
      ) : null}

      {step === 3 ? (
        <Card className="space-y-4">
          <h2 className="font-semibold">4. Estimate effort and commit time</h2>
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Total effort (hours)" htmlFor="w-hours" hint="Rough is fine; GoalFlow learns from your timed sessions.">
              <Input id="w-hours" type="number" min="1" value={form.estimatedHours} onChange={(e) => set("estimatedHours", e.target.value)} />
              {err("estimatedHours")}
            </Field>
            <Field label="Sessions per week" htmlFor="w-spw">
              <Input id="w-spw" type="number" min="0" max="21" value={form.sessionsPerWeek} onChange={(e) => set("sessionsPerWeek", e.target.value)} />
            </Field>
            <Field label="Minutes per session" htmlFor="w-min">
              <Input id="w-min" type="number" min="5" max="480" value={form.sessionMinutes} onChange={(e) => set("sessionMinutes", e.target.value)} />
            </Field>
            <Field label="Typical daily action" htmlFor="w-act" className="sm:col-span-2">
              <Input id="w-act" value={form.dailyAction} onChange={(e) => set("dailyAction", e.target.value)} placeholder="e.g. Read 30 pages" />
            </Field>
            <Field label="Weekly targets for the next" htmlFor="w-wk" hint="Keeps the plan reviewable.">
              <Select id="w-wk" value={form.weeksForMonths} onChange={(e) => set("weeksForMonths", e.target.value)}>
                <option value="0">No weekly goals yet</option>
                <option value="1">1 month</option>
                <option value="2">2 months</option>
                <option value="3">3 months</option>
              </Select>
            </Field>
          </div>
          <label className={cn("flex items-center gap-2 text-sm", !aiEnabled && "text-muted")}>
            <input type="checkbox" checked={form.useAi} disabled={!aiEnabled} onChange={(e) => set("useAi", e.target.checked)} />
            <Sparkles size={14} /> Let the AI assistant suggest milestones, clearer targets and first-week actions
            {!aiEnabled ? <Badge tone="warn">not configured</Badge> : null}
          </label>
        </Card>
      ) : null}

      {step === 4 && plan ? (
        <div className="space-y-4">
          <Card>
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="font-semibold">5. Review and approve your plan</h2>
              <Badge tone={plan.source === "ai" ? "accent" : "neutral"}>{plan.source === "ai" ? "AI-assisted" : "Built-in planner"}</Badge>
            </div>
            <div className={cn("mt-3 rounded-lg p-3 text-sm", plan.workload.fits ? "bg-ok-soft" : "bg-danger-soft text-danger")}>
              <p className="font-medium">{plan.workload.fits ? "Workload fits your availability" : "Workload exceeds your availability"}</p>
              <p className="mt-0.5">{plan.workload.message}</p>
            </div>
            {plan.notes.length ? (
              <ul className="mt-3 list-disc space-y-0.5 pl-5 text-sm text-muted">
                {plan.notes.map((n, i) => (
                  <li key={i}>{n}</li>
                ))}
              </ul>
            ) : null}
            <p className="mt-3 text-sm text-muted">
              Nothing is saved yet. Edit titles and targets, untick anything you don&apos;t want, then approve. {plan.goals.filter((g) => g.include).length} goals and{" "}
              {plan.tasks.filter((t) => t.include).length} tasks will be created.
            </p>
          </Card>

          {plan.milestones.length ? (
            <Card>
              <h3 className="mb-2 font-semibold">Milestones</h3>
              <ul className="space-y-2">
                {plan.milestones.map((m, i) => (
                  <li key={i} className="flex items-center gap-2">
                    <Input
                      aria-label={`Milestone ${i + 1}`}
                      value={m.title}
                      onChange={(e) => setPlan({ ...plan, milestones: plan.milestones.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                    />
                    <Input
                      aria-label={`Milestone ${i + 1} weight`}
                      type="number"
                      className="w-24"
                      value={m.weight}
                      onChange={(e) => setPlan({ ...plan, milestones: plan.milestones.map((x, j) => (j === i ? { ...x, weight: Number(e.target.value) || 1 } : x)) })}
                    />
                    <Button variant="ghost" aria-label="Remove" onClick={() => setPlan({ ...plan, milestones: plan.milestones.filter((_, j) => j !== i) })}>
                      <Trash2 size={14} />
                    </Button>
                  </li>
                ))}
              </ul>
            </Card>
          ) : null}

          <Card>
            <h3 className="mb-2 font-semibold">Goal breakdown</h3>
            <ul className="space-y-1.5">
              {plan.goals.map((g) => {
                const depth = g.key.split(".").length - 1;
                return (
                  <li key={g.key} className={cn("flex flex-wrap items-center gap-2 rounded-lg p-1.5", !g.include && "opacity-50")} style={{ paddingLeft: `${depth * 14}px` }}>
                    <input
                      type="checkbox"
                      checked={g.include}
                      disabled={g.parentKey === null}
                      onChange={(e) => toggleGoal(g.key, e.target.checked)}
                      aria-label={`Include ${g.title}`}
                    />
                    <Badge tone="info" className="w-20 justify-center">
                      {GOAL_LEVEL_LABEL[g.level].split(" ")[0]}
                    </Badge>
                    <Input
                      aria-label={`${g.level} title`}
                      className="h-8 min-w-48 flex-1"
                      value={g.title}
                      onChange={(e) => setPlan({ ...plan, goals: plan.goals.map((x) => (x.key === g.key ? { ...x, title: e.target.value } : x)) })}
                    />
                    <span className="text-xs text-muted">
                      {g.startDate} → {g.targetDate}
                    </span>
                    <label className="flex items-center gap-1 text-xs text-muted">
                      target
                      <Input
                        type="number"
                        step="any"
                        className="h-8 w-20"
                        value={g.targetValue}
                        onChange={(e) => setPlan({ ...plan, goals: plan.goals.map((x) => (x.key === g.key ? { ...x, targetValue: Number(e.target.value) } : x)) })}
                      />
                      {g.unit}
                    </label>
                    <span className="text-xs text-muted">{g.estimatedHours}h</span>
                  </li>
                );
              })}
            </ul>
          </Card>

          <Card>
            <h3 className="mb-2 font-semibold">Proposed daily actions (first week)</h3>
            {plan.tasks.length ? (
              <ul className="space-y-1.5">
                {plan.tasks.map((t, i) => (
                  <li key={t.key} className={cn("flex flex-wrap items-center gap-2", !t.include && "opacity-50")}>
                    <input
                      type="checkbox"
                      checked={t.include}
                      onChange={(e) => setPlan({ ...plan, tasks: plan.tasks.map((x, j) => (j === i ? { ...x, include: e.target.checked } : x)) })}
                      aria-label={`Include ${t.title}`}
                    />
                    <Input
                      aria-label="Task title"
                      className="h-8 min-w-48 flex-1"
                      value={t.title}
                      onChange={(e) => setPlan({ ...plan, tasks: plan.tasks.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)) })}
                    />
                    <Input
                      aria-label="Date"
                      type="date"
                      className="h-8 w-40"
                      value={t.date}
                      onChange={(e) => setPlan({ ...plan, tasks: plan.tasks.map((x, j) => (j === i ? { ...x, date: e.target.value } : x)) })}
                    />
                    <Input
                      aria-label="Minutes"
                      type="number"
                      className="h-8 w-20"
                      value={t.estimatedMinutes}
                      onChange={(e) => setPlan({ ...plan, tasks: plan.tasks.map((x, j) => (j === i ? { ...x, estimatedMinutes: Number(e.target.value) || 30 } : x)) })}
                    />
                    <Select
                      aria-label="Priority"
                      className="h-8 w-28"
                      value={t.priority}
                      onChange={(e) => setPlan({ ...plan, tasks: plan.tasks.map((x, j) => (j === i ? { ...x, priority: e.target.value as DraftTask["priority"] } : x)) })}
                    >
                      {PRIORITIES.map((p) => (
                        <option key={p} value={p}>
                          {titleCase(p)}
                        </option>
                      ))}
                    </Select>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="text-sm text-muted">No daily actions proposed. You can add tasks after saving.</p>
            )}
          </Card>
        </div>
      ) : null}

      {error ? (
        <div role="alert" className="rounded-lg bg-danger-soft p-3 text-sm text-danger">
          {error}
          {Object.keys(errors).length ? (
            <ul className="mt-1 list-disc pl-5 text-xs">
              {Object.entries(errors).map(([k, v]) => (
                <li key={k}>
                  {k}: {v}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      ) : null}

      <div className="flex justify-between gap-2">
        <Button disabled={step === 0 || pending} onClick={() => setStep((s) => s - 1)}>
          Back
        </Button>
        {step < 3 ? (
          <Button variant="primary" onClick={() => stepValid() && setStep((s) => s + 1)}>
            Next
          </Button>
        ) : step === 3 ? (
          <Button variant="primary" disabled={pending} onClick={generate}>
            {pending ? "Building plan…" : "Generate plan"}
          </Button>
        ) : (
          <Button variant="primary" disabled={pending} onClick={approve}>
            {pending ? "Saving…" : "Approve and create"}
          </Button>
        )}
      </div>
    </div>
  );
}
