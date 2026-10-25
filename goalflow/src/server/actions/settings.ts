"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { PreferencesSchema, ScheduleSchema } from "@/lib/validation/account";
import { fieldErrors, formToObject, type ActionResult } from "@/lib/validation/common";
import { destroySession, requireAuth } from "@/server/auth/session";
import {
  AccountError,
  addSchedule,
  changePassword,
  deleteAccount,
  deleteSchedule,
  updatePreferences,
  updateProfile,
} from "@/server/services/account";

export async function savePreferencesAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const raw = formToObject(fd);
  const parsed = PreferencesSchema.safeParse({
    ...raw,
    workingDays: raw.workingDays ?? [],
    defaultChannels: raw.defaultChannels ?? [],
  });
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  await updatePreferences(user.id, parsed.data);
  revalidatePath("/", "layout");
  return { ok: true, message: "Settings saved." };
}

export async function saveProfileAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const name = z.string().trim().min(1, "Enter your name").max(80).safeParse(fd.get("name"));
  if (!name.success) return { ok: false, error: name.error.issues[0]!.message, fieldErrors: { name: name.error.issues[0]!.message } };
  await updateProfile(user.id, name.data);
  revalidatePath("/", "layout");
  return { ok: true, message: "Profile saved." };
}

export async function changePasswordAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const parsed = z
    .object({ current: z.string().min(1, "Enter your current password"), next: z.string().min(10, "Use at least 10 characters").max(200) })
    .safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  try {
    await changePassword(user.id, parsed.data.current, parsed.data.next);
  } catch (err) {
    if (err instanceof AccountError) return { ok: false, error: err.message, fieldErrors: { current: err.message } };
    throw err;
  }
  return { ok: true, message: "Password changed." };
}

export async function addScheduleAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  const raw = formToObject(fd);
  const parsed = ScheduleSchema.safeParse({ ...raw, days: raw.days ?? [] });
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  await addSchedule(user.id, parsed.data);
  revalidatePath("/settings");
  return { ok: true, message: "Commitment added." };
}

export async function deleteScheduleAction(id: string) {
  const { user } = await requireAuth();
  await deleteSchedule(user.id, z.string().uuid().parse(id));
  revalidatePath("/settings");
}

export async function deleteAccountAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user } = await requireAuth();
  if (fd.get("confirm") !== "DELETE") return { ok: false, error: 'Type DELETE to confirm.', fieldErrors: { confirm: "Type DELETE" } };
  try {
    await deleteAccount(user.id, String(fd.get("password") ?? ""));
  } catch (err) {
    if (err instanceof AccountError) return { ok: false, error: err.message, fieldErrors: { password: err.message } };
    throw err;
  }
  await destroySession();
  redirect("/register");
}
