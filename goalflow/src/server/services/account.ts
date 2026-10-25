import { and, asc, eq, sql } from "drizzle-orm";
import type { z } from "zod";
import { db, type Executor } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { hashPassword, verifyPassword } from "@/server/auth/password";
import type { PreferencesSchema, RegisterSchema, ScheduleSchema } from "@/lib/validation/account";
import { audit } from "./audit";
import { syncSystemReminders } from "./reminders";

export class AccountError extends Error {}

export async function registerUser(input: z.infer<typeof RegisterSchema>) {
  const passwordHash = await hashPassword(input.password);
  return db().transaction(async (tx) => {
    const existing = await tx
      .select({ id: s.users.id })
      .from(s.users)
      .where(sql`lower(${s.users.email}) = ${input.email.toLowerCase()}`);
    if (existing.length) throw new AccountError("An account with this email already exists.");
    const [user] = await tx.insert(s.users).values({ email: input.email.toLowerCase(), name: input.name, passwordHash }).returning();
    const [prefs] = await tx.insert(s.userPreferences).values({ userId: user!.id, timezone: input.timezone }).returning();
    await syncSystemReminders(tx, user!.id, prefs!);
    await audit(tx, user!.id, "user", user!.id, "account.created");
    return user!;
  });
}

/** Constant-ish time login: always runs bcrypt, even for unknown emails. */
let dummyHash: Promise<string> | null = null;
export async function authenticate(email: string, password: string) {
  const [user] = await db()
    .select()
    .from(s.users)
    .where(sql`lower(${s.users.email}) = ${email.toLowerCase()}`);
  dummyHash ??= hashPassword("not-a-real-password");
  const ok = await verifyPassword(password, user?.passwordHash ?? (await dummyHash));
  return ok && user ? user : null;
}

export async function getPreferences(userId: string) {
  const [p] = await db().select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId));
  if (!p) throw new AccountError("Preferences missing");
  return p;
}

export async function updatePreferences(userId: string, input: z.infer<typeof PreferencesSchema>) {
  return db().transaction(async (tx) => {
    const [prefs] = await tx
      .update(s.userPreferences)
      .set({ ...input, onboarded: true })
      .where(eq(s.userPreferences.userId, userId))
      .returning();
    // Review/planning reminder times depend on preferences; recompute their next fire time.
    await syncSystemReminders(tx, userId, prefs!);
    await audit(tx, userId, "preferences", null, "preferences.updated", { timezone: input.timezone });
    return prefs!;
  });
}

export async function updateProfile(userId: string, name: string) {
  await db().update(s.users).set({ name }).where(eq(s.users.id, userId));
}

export async function changePassword(userId: string, current: string, next: string) {
  const [u] = await db().select().from(s.users).where(eq(s.users.id, userId));
  if (!u || !(await verifyPassword(current, u.passwordHash))) throw new AccountError("Current password is incorrect.");
  await db().transaction(async (tx) => {
    await tx.update(s.users).set({ passwordHash: await hashPassword(next) }).where(eq(s.users.id, userId));
    await audit(tx, userId, "user", userId, "password.changed");
  });
}

// ---- recurring commitments (schedules)

export function listSchedules(userId: string, ex: Executor = db()) {
  return ex.select().from(s.schedules).where(eq(s.schedules.userId, userId)).orderBy(asc(s.schedules.startTime));
}

export async function addSchedule(userId: string, input: z.infer<typeof ScheduleSchema>) {
  const [row] = await db().insert(s.schedules).values({ ...input, userId }).returning();
  return row!;
}

export async function deleteSchedule(userId: string, id: string) {
  await db().delete(s.schedules).where(and(eq(s.schedules.id, id), eq(s.schedules.userId, userId)));
}

// ---- export & deletion

/** Full JSON export of a user's data (account data portability + manual backup). */
export async function exportUserData(userId: string) {
  const d = db();
  const [user] = await d
    .select({ id: s.users.id, email: s.users.email, name: s.users.name, createdAt: s.users.createdAt })
    .from(s.users)
    .where(eq(s.users.id, userId));
  const [preferences, schedules, goals, milestones, snapshots, tasks, checklist, dependencies, sessions, reminders, notifications, notes, tags, reviews, rules] =
    await Promise.all([
      d.select().from(s.userPreferences).where(eq(s.userPreferences.userId, userId)),
      d.select().from(s.schedules).where(eq(s.schedules.userId, userId)),
      d.select().from(s.goals).where(eq(s.goals.userId, userId)),
      d.select().from(s.goalMilestones).where(eq(s.goalMilestones.userId, userId)),
      d.select().from(s.progressSnapshots).where(eq(s.progressSnapshots.userId, userId)),
      d.select().from(s.tasks).where(eq(s.tasks.userId, userId)),
      d.select().from(s.taskChecklistItems).where(eq(s.taskChecklistItems.userId, userId)),
      d.select().from(s.taskDependencies).where(eq(s.taskDependencies.userId, userId)),
      d.select().from(s.workSessions).where(eq(s.workSessions.userId, userId)),
      d.select().from(s.reminders).where(eq(s.reminders.userId, userId)),
      d.select().from(s.notifications).where(eq(s.notifications.userId, userId)),
      d.select().from(s.notes).where(eq(s.notes.userId, userId)),
      d.select().from(s.tags).where(eq(s.tags.userId, userId)),
      d.select().from(s.reviewReports).where(eq(s.reviewReports.userId, userId)),
      d.select().from(s.recurringRules).where(eq(s.recurringRules.userId, userId)),
    ]);
  const noteTags = await d
    .select({ noteId: s.noteTags.noteId, tagId: s.noteTags.tagId })
    .from(s.noteTags)
    .innerJoin(s.notes, eq(s.notes.id, s.noteTags.noteId))
    .where(eq(s.notes.userId, userId));
  return {
    format: "goalflow-export",
    version: 1,
    exportedAt: new Date().toISOString(),
    user,
    preferences: preferences[0] ?? null,
    schedules,
    recurringRules: rules,
    goals,
    milestones,
    progressSnapshots: snapshots,
    tasks,
    taskChecklistItems: checklist,
    taskDependencies: dependencies,
    workSessions: sessions,
    reminders,
    notifications,
    notes: notes.map(({ search: _search, ...n }) => n),
    tags,
    noteTags,
    reviewReports: reviews,
  };
}

/** Permanently delete the account. All owned rows cascade from users. */
export async function deleteAccount(userId: string, password: string) {
  const [u] = await db().select().from(s.users).where(eq(s.users.id, userId));
  if (!u || !(await verifyPassword(password, u.passwordHash))) throw new AccountError("Password is incorrect.");
  await db().delete(s.users).where(eq(s.users.id, userId));
}
