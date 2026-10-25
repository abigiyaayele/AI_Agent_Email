"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { PERIOD_TYPES } from "@/lib/constants";
import { fieldErrors, formToObject, isoDate, type ActionResult } from "@/lib/validation/common";
import { rateLimit } from "@/server/auth/rate-limit";
import { requireAuth } from "@/server/auth/session";
import { generateSummary, ReflectionSchema, saveReflection } from "@/server/services/reviews";

const type = z.enum(PERIOD_TYPES);

export async function saveReflectionAction(periodType: string, date: string, _prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const parsed = ReflectionSchema.safeParse(formToObject(fd));
  if (!parsed.success) return { ok: false, error: "Please shorten the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  await saveReflection(user.id, prefs, type.parse(periodType), isoDate.parse(date), parsed.data);
  revalidatePath("/plan", "layout");
  return { ok: true, message: "Review saved." };
}

export async function generateSummaryAction(periodType: string, date: string): Promise<ActionResult<{ text: string; source: string }>> {
  const { user, prefs } = await requireAuth();
  if (!(await rateLimit(`ai:${user.id}`, 30, 3600))) return { ok: false, error: "Too many summaries this hour. Please try again later." };
  const r = await generateSummary(user.id, prefs, type.parse(periodType), isoDate.parse(date));
  revalidatePath("/plan", "layout");
  return { ok: true, message: r.warning ? `${r.warning} Showing the built-in summary instead.` : undefined, data: { text: r.text, source: r.source } };
}
