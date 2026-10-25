"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { CHANNELS } from "@/lib/constants";
import { isoWeekday, localToInstant } from "@/lib/domain/periods";
import { fieldErrors, formToObject, hhmm, isoDate, trimmed, type ActionResult } from "@/lib/validation/common";
import { requireAuth } from "@/server/auth/session";
import {
  createCustomReminder,
  deleteReminder,
  markNotifications,
  setReminderActive,
  snoozeNotification,
  updateReminderChannels,
} from "@/server/services/reminders";

const id = z.string().uuid();
const revalidate = () => revalidatePath("/", "layout");

export async function markNotificationsAction(ids: string[] | "all", action: "read" | "dismiss") {
  const { user } = await requireAuth();
  await markNotifications(user.id, ids === "all" ? "all" : z.array(id).max(500).parse(ids), z.enum(["read", "dismiss"]).parse(action));
  revalidate();
}

export async function snoozeAction(notificationId: string, minutes: number): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const m = z.number().int().min(5).max(7 * 24 * 60).parse(minutes);
  const at = await snoozeNotification(user.id, id.parse(notificationId), m);
  revalidate();
  if (!at) return { ok: false, error: "Notification not found." };
  return { ok: true, message: `Snoozed until ${at.toLocaleTimeString("en-GB", { timeZone: prefs.timezone, hour: "2-digit", minute: "2-digit" })}.` };
}

const ReminderSchema = z.object({
  title: trimmed(200).min(1, "Give the reminder a title"),
  body: trimmed(1000).default(""),
  date: isoDate,
  time: hhmm,
  repeat: z.enum(["none", "daily", "weekdays", "weekly", "monthly"]).default("none"),
  channels: z.array(z.enum(CHANNELS)).default(["in_app"]),
});

export async function createReminderAction(_prev: unknown, fd: FormData): Promise<ActionResult> {
  const { user, prefs } = await requireAuth();
  const raw = formToObject(fd);
  const parsed = ReminderSchema.safeParse({ ...raw, channels: raw.channels ?? ["in_app"] });
  if (!parsed.success) return { ok: false, error: "Please fix the highlighted fields.", fieldErrors: fieldErrors(parsed.error) };
  const d = parsed.data;
  const at = localToInstant(d.date, d.time, prefs.timezone);
  if (d.repeat === "none" && at.getTime() < Date.now()) return { ok: false, error: "That time is in the past.", fieldErrors: { time: "Pick a future time" } };
  const startLocal = `${d.date}T${d.time}`;
  const rule =
    d.repeat === "none"
      ? null
      : {
          freq: d.repeat === "weekdays" ? ("weekly" as const) : d.repeat,
          interval: 1,
          byWeekday: d.repeat === "weekdays" ? [1, 2, 3, 4, 5] : d.repeat === "weekly" ? [isoWeekday(d.date)] : null,
          byMonthDay: d.repeat === "monthly" ? Number(d.date.slice(8)) : null,
          startLocal,
          timezone: prefs.timezone,
          untilDate: null,
          count: null,
        };
  await createCustomReminder(user.id, prefs, { title: d.title, body: d.body, at, channels: d.channels, rule });
  revalidate();
  return { ok: true, message: "Reminder created." };
}

export async function toggleReminderAction(reminderId: string, active: boolean) {
  const { user, prefs } = await requireAuth();
  await setReminderActive(user.id, id.parse(reminderId), active, prefs);
  revalidate();
}

export async function reminderChannelsAction(reminderId: string, channels: string[]) {
  const { user } = await requireAuth();
  await updateReminderChannels(user.id, id.parse(reminderId), z.array(z.enum(CHANNELS)).parse(channels));
  revalidate();
}

export async function deleteReminderAction(reminderId: string) {
  const { user } = await requireAuth();
  await deleteReminder(user.id, id.parse(reminderId));
  revalidate();
}
