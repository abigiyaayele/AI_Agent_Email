"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { GOAL_STATUSES } from "@/lib/constants";
import { generateBreakdown, type DraftPlan } from "@/lib/domain/breakdown";
import { todayIn } from "@/lib/domain/periods";
import { fieldErrors, formToObject, type ActionResult } from "@/lib/validation/common";
import { ApplyPlanSchema, BreakdownSchema, GoalSchema, MilestoneSchema, ProgressUpdateSchema, type ApplyPlan } from "@/lib/validation/goal";
import { requireAuth } from "@/server/auth/session";
import { refinePlanWithAi } from "@/server/ai/planning";
import {
  addMilestone,
  applyPlan,
  createGoal,
  deleteGoal,
  deleteMilestone,
  GoalError,
  recordProgress,
  setGoalStatus,
  toggleMilestone,
  updateGoal,
} from "@/server/services/goals";

const id = z.string().uuid();

function goalError(err: unknown): ActionResult {
  if (err instanceof GoalError) return { ok: false, error: err.message, fieldErrors: err.field ? { [err.field]: err.message } : undefined };
  if (err instanceof Error && /cycle|own parent|another user/.test(err.message)) return { ok: false, error: err.message };
  throw err;
}

export async function createGoalAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const parsed = GoalSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  let goalId: string;
  try {
    goalId = (await createGoal(user.id, parsed.data)).id;
  } catch (err) {
    return goalError(err);
  }
  revalidatePath("/goals");
  redirect(`/goals/${goalId}`);
}

export async function updateGoalAction(goalId: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const parsed = GoalSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await updateGoal(user.id, id.parse(goalId), parsed.data);
  } catch (err) {
    return goalError(err);
  }
  revalidatePath("/goals", "layout");
  return { ok: true, message: "Goal saved." };
}

export async function setGoalStatusAction(goalId: string, status: string) {
  const { user } = await requireAuth();
  await setGoalStatus(user.id, id.parse(goalId), z.enum(GOAL_STATUSES).parse(status));
  revalidatePath("/goals", "layout");
}

export async function deleteGoalAction(goalId: string, mode: "reparent" | "cascade") {
  const { user } = await requireAuth();
  await deleteGoal(user.id, id.parse(goalId), z.enum(["reparent", "cascade"]).parse(mode));
  revalidatePath("/goals", "layout");
  redirect("/goals");
}

export async function recordProgressAction(goalId: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const parsed = ProgressUpdateSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Enter a valid number.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await recordProgress(user.id, id.parse(goalId), parsed.data.value, parsed.data.note);
  } catch (err) {
    return goalError(err);
  }
  revalidatePath("/goals", "layout");
  return { ok: true, message: "Progress recorded." };
}

export async function addMilestoneAction(goalId: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const parsed = MilestoneSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await addMilestone(user.id, id.parse(goalId), parsed.data);
  } catch (err) {
    return goalError(err);
  }
  revalidatePath(`/goals/${goalId}`);
  return { ok: true, message: "Milestone added." };
}

export async function toggleMilestoneAction(milestoneId: string, done: boolean) {
  const { user } = await requireAuth();
  await toggleMilestone(user.id, id.parse(milestoneId), done);
  revalidatePath("/goals", "layout");
}

export async function deleteMilestoneAction(milestoneId: string) {
  const { user } = await requireAuth();
  await deleteMilestone(user.id, id.parse(milestoneId));
  revalidatePath("/goals", "layout");
}

export type DraftResult = ActionResult<{ plan: DraftPlan; source: "rules" | "ai"; notes: string[] }>;

/** Build a proposed plan. Nothing is saved until the user approves it. */
export async function draftPlanAction(input: unknown): Promise<DraftResult> {
  const { prefs } = await requireAuth();
  const parsed = BreakdownSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const today = todayIn(prefs.timezone);
  const base = generateBreakdown({ ...parsed.data, outcome: parsed.data.outcome }, prefs, today);
  if (!parsed.data.useAi) return { ok: true, data: { plan: base, source: "rules", notes: [] } };
  const refined = await refinePlanWithAi(parsed.data, base, prefs, today);
  return { ok: true, data: refined };
}

export async function applyPlanAction(plan: ApplyPlan): Promise<ActionResult<{ rootId: string }>> {
  const { user, prefs } = await requireAuth();
  const parsed = ApplyPlanSchema.safeParse(plan);
  if (!parsed.success) return { ok: false, error: "The plan has invalid entries.", fieldErrors: fieldErrors(parsed.error) };
  try {
    const res = await applyPlan(user.id, parsed.data, prefs.timezone);
    revalidatePath("/goals", "layout");
    return { ok: true, data: { rootId: res.rootId }, message: `Created ${res.goals} goals and ${res.tasks} tasks.` };
  } catch (err) {
    return goalError(err) as ActionResult<{ rootId: string }>;
  }
}
