import { and, desc, eq, inArray, isNull, lte, or, sql } from "drizzle-orm";
import type { Channel, ReminderKind } from "@/lib/constants";
import { computeNextFire, fireKey, SYSTEM_REMINDERS, type ReminderPrefs } from "@/lib/domain/reminders";
import type { RecurrenceRule } from "@/lib/domain/recurrence";
import { db, type Executor } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { deliverNotification } from "@/server/notifications/deliver";

type Prefs = Pick<s.Preferences, "timezone" | "dailyPlanTime" | "dailyReviewTime" | "weeklyReviewDay" | "defaultChannels">;

const toReminderPrefs = (p: Prefs): ReminderPrefs => ({
  timezone: p.timezone,
  dailyPlanTime: p.dailyPlanTime,
  dailyReviewTime: p.dailyReviewTime,
  weeklyReviewDay: p.weeklyReviewDay,
});

const toRule = (r: s.RecurringRule | null): RecurrenceRule | null =>
  r
    ? {
        freq: r.freq,
        interval: r.interval,
        byWeekday: r.byWeekday,
        byMonthDay: r.byMonthDay,
        startLocal: r.startLocal,
        timezone: r.timezone,
        untilDate: r.untilDate,
        count: r.count,
      }
    : null;

/** Ensure the built-in planning/review reminders exist and are scheduled from current prefs. */
export async function syncSystemReminders(ex: Executor, userId: string, prefs: Prefs, now: Date = new Date()) {
  for (const def of SYSTEM_REMINDERS) {
    const next = computeNextFire(
      { kind: def.kind, offsetMinutes: null, rule: null, fixedAt: null, task: null },
      toReminderPrefs(prefs),
      now,
    );
    const [existing] = await ex
      .select()
      .from(s.reminders)
      .where(and(eq(s.reminders.userId, userId), eq(s.reminders.kind, def.kind), isNull(s.reminders.taskId), isNull(s.reminders.goalId)));
    if (existing) {
      await ex.update(s.reminders).set({ nextFireAt: next }).where(eq(s.reminders.id, existing.id));
    } else {
      await ex.insert(s.reminders).values({
        userId,
        kind: def.kind,
        title: def.title,
        body: def.body,
        url: def.url,
        nextFireAt: next,
        channels: prefs.defaultChannels.length ? prefs.defaultChannels : ["in_app"],
        // Daily planning on by default; longer reviews too. Users can switch any off.
        active: true,
      });
    }
  }
}

export type TaskReminderInput = { startOffset: number | null; deadlineOffset: number | null };

/**
 * Create/update/remove the start and deadline reminders of a task to match the given offsets,
 * and recompute their next fire times from the task's current schedule.
 */
export async function syncTaskReminders(
  ex: Executor,
  userId: string,
  task: Pick<s.Task, "id" | "title" | "scheduledStart" | "dueAt" | "status">,
  prefs: Prefs,
  input: TaskReminderInput | undefined,
  now: Date = new Date(),
) {
  const existing = await ex
    .select()
    .from(s.reminders)
    .where(and(eq(s.reminders.userId, userId), eq(s.reminders.taskId, task.id)));
  const pairs: [ReminderKind, number | null | undefined][] = [
    ["task_start", input ? input.startOffset : undefined],
    ["deadline", input ? input.deadlineOffset : undefined],
  ];
  for (const [kind, offset] of pairs) {
    const row = existing.find((r) => r.kind === kind);
    if (offset === undefined) {
      // Offsets unchanged: just reschedule from the (possibly moved) task times.
      if (row) {
        const next = computeNextFire({ kind, offsetMinutes: row.offsetMinutes, rule: null, fixedAt: null, task }, toReminderPrefs(prefs), now);
        await ex.update(s.reminders).set({ nextFireAt: next, title: reminderTitle(kind, task.title) }).where(eq(s.reminders.id, row.id));
      }
      continue;
    }
    if (offset === null) {
      if (row) await ex.delete(s.reminders).where(eq(s.reminders.id, row.id));
      continue;
    }
    const next = computeNextFire({ kind, offsetMinutes: offset, rule: null, fixedAt: null, task }, toReminderPrefs(prefs), now);
    if (row) {
      await ex
        .update(s.reminders)
        .set({ offsetMinutes: offset, nextFireAt: next, title: reminderTitle(kind, task.title), active: true })
        .where(eq(s.reminders.id, row.id));
    } else {
      await ex.insert(s.reminders).values({
        userId,
        kind,
        taskId: task.id,
        title: reminderTitle(kind, task.title),
        body: kind === "task_start" ? `Starts in ${offset} min` : `Due in ${offset} min`,
        url: `/tasks/${task.id}`,
        offsetMinutes: offset,
        nextFireAt: next,
        channels: prefs.defaultChannels.length ? prefs.defaultChannels : ["in_app"],
      });
    }
  }
}

const reminderTitle = (kind: ReminderKind, title: string) => (kind === "task_start" ? `Starting soon: ${title}` : `Deadline: ${title}`);

export async function createCustomReminder(
  userId: string,
  prefs: Prefs,
  input: { title: string; body: string; at: Date; channels: Channel[]; rule: Omit<s.RecurringRule, "id" | "userId" | "createdAt"> | null },
  now: Date = new Date(),
) {
  return db().transaction(async (tx) => {
    let ruleRow: s.RecurringRule | null = null;
    if (input.rule) [ruleRow] = await tx.insert(s.recurringRules).values({ ...input.rule, userId }).returning() as [s.RecurringRule];
    const next = ruleRow
      ? computeNextFire({ kind: "custom", offsetMinutes: null, rule: toRule(ruleRow), fixedAt: null, task: null }, toReminderPrefs(prefs), new Date(now.getTime() - 60_000))
      : input.at;
    const [r] = await tx
      .insert(s.reminders)
      .values({
        userId,
        kind: "custom",
        title: input.title,
        body: input.body,
        channels: input.channels.length ? input.channels : ["in_app"],
        nextFireAt: next,
        recurringRuleId: ruleRow?.id ?? null,
      })
      .returning();
    return r!;
  });
}

export async function listReminders(userId: string) {
  return db()
    .select({ reminder: s.reminders, rule: s.recurringRules, taskTitle: s.tasks.title })
    .from(s.reminders)
    .leftJoin(s.recurringRules, eq(s.recurringRules.id, s.reminders.recurringRuleId))
    .leftJoin(s.tasks, eq(s.tasks.id, s.reminders.taskId))
    .where(eq(s.reminders.userId, userId))
    .orderBy(sql`${s.reminders.nextFireAt} asc nulls last`);
}

export async function setReminderActive(userId: string, id: string, active: boolean, prefs: Prefs, now = new Date()) {
  await db().transaction(async (tx) => {
    const [r] = await tx.select().from(s.reminders).where(and(eq(s.reminders.id, id), eq(s.reminders.userId, userId)));
    if (!r) return;
    let next = r.nextFireAt;
    if (active && (!next || next < now)) {
      const [rule] = r.recurringRuleId ? await tx.select().from(s.recurringRules).where(eq(s.recurringRules.id, r.recurringRuleId)) : [null];
      const [task] = r.taskId ? await tx.select().from(s.tasks).where(eq(s.tasks.id, r.taskId)) : [null];
      next = computeNextFire(
        { kind: r.kind, offsetMinutes: r.offsetMinutes, rule: toRule(rule ?? null), fixedAt: null, task: task ?? null },
        toReminderPrefs(prefs),
        now,
      );
    }
    await tx.update(s.reminders).set({ active, nextFireAt: next }).where(eq(s.reminders.id, id));
  });
}

export async function updateReminderChannels(userId: string, id: string, channels: Channel[]) {
  await db()
    .update(s.reminders)
    .set({ channels: channels.length ? channels : ["in_app"] })
    .where(and(eq(s.reminders.id, id), eq(s.reminders.userId, userId)));
}

export async function deleteReminder(userId: string, id: string) {
  await db().delete(s.reminders).where(and(eq(s.reminders.id, id), eq(s.reminders.userId, userId)));
}

/**
 * Fire every due reminder exactly once per occurrence.
 * - Rows are claimed with FOR UPDATE SKIP LOCKED, so concurrent workers never double-process.
 * - Each occurrence inserts a notification with a unique `fire_key`; a retry after a crash hits
 *   the unique index and does nothing, so users never get duplicates.
 * - If the server was down, recurring reminders resume from "now" instead of replaying a backlog.
 */
export async function processDueReminders(opts: { now?: Date; userId?: string; limit?: number } = {}) {
  const now = opts.now ?? new Date();
  const created: s.Notification[] = [];
  const channelsByNotification = new Map<string, Channel[]>();
  await db().transaction(async (tx) => {
    const due = await tx
      .select({ r: s.reminders, prefs: s.userPreferences })
      .from(s.reminders)
      .innerJoin(s.userPreferences, eq(s.userPreferences.userId, s.reminders.userId))
      .where(
        and(
          eq(s.reminders.active, true),
          lte(s.reminders.nextFireAt, now),
          opts.userId ? eq(s.reminders.userId, opts.userId) : undefined,
        ),
      )
      .orderBy(s.reminders.nextFireAt)
      .limit(opts.limit ?? 200)
      .for("update", { of: s.reminders, skipLocked: true });

    for (const { r, prefs } of due) {
      const fireAt = r.nextFireAt!;
      const [task] = r.taskId ? await tx.select().from(s.tasks).where(eq(s.tasks.id, r.taskId)) : [null];
      const [rule] = r.recurringRuleId
        ? await tx.select().from(s.recurringRules).where(eq(s.recurringRules.id, r.recurringRuleId))
        : [null];
      const skip = task && task.status === "done";
      if (!skip) {
        const [n] = await tx
          .insert(s.notifications)
          .values({
            userId: r.userId,
            reminderId: r.id,
            fireKey: fireKey(r.id, fireAt),
            title: r.title,
            body: r.body,
            url: r.url,
            deliveredChannels: ["in_app"],
          })
          .onConflictDoNothing({ target: s.notifications.fireKey })
          .returning();
        if (n) {
          created.push(n);
          channelsByNotification.set(n.id, r.channels);
        }
      }
      const after = new Date(Math.max(fireAt.getTime(), now.getTime()));
      const next = computeNextFire(
        { kind: r.kind, offsetMinutes: r.offsetMinutes, rule: toRule(rule ?? null), fixedAt: null, task: task ?? null },
        toReminderPrefs(prefs),
        after,
      );
      await tx.update(s.reminders).set({ nextFireAt: next, lastFiredAt: now, snoozedUntil: null }).where(eq(s.reminders.id, r.id));
    }
  });

  // External delivery happens after commit, so a slow push/email provider never holds locks.
  for (const n of created) {
    await deliverNotification(n, channelsByNotification.get(n.id) ?? ["in_app"]);
  }
  return created;
}

// ---- notification inbox

export function listNotifications(userId: string, limit = 100) {
  return db()
    .select()
    .from(s.notifications)
    .where(eq(s.notifications.userId, userId))
    .orderBy(desc(s.notifications.createdAt))
    .limit(limit);
}

export async function unreadCount(userId: string) {
  const [row] = await db()
    .select({ n: sql<number>`count(*)::int` })
    .from(s.notifications)
    .where(and(eq(s.notifications.userId, userId), isNull(s.notifications.readAt), isNull(s.notifications.dismissedAt)));
  return row?.n ?? 0;
}

export async function markNotifications(userId: string, ids: string[] | "all", action: "read" | "dismiss") {
  const now = new Date();
  const set = action === "read" ? { readAt: now } : { dismissedAt: now, readAt: now };
  await db()
    .update(s.notifications)
    .set(set)
    .where(and(eq(s.notifications.userId, userId), ids === "all" ? undefined : inArray(s.notifications.id, ids)));
}

/** Snooze = a one-off reminder that re-sends the same notification later. */
export async function snoozeNotification(userId: string, id: string, minutes: number) {
  const [n] = await db()
    .select()
    .from(s.notifications)
    .where(and(eq(s.notifications.id, id), eq(s.notifications.userId, userId)));
  if (!n) return null;
  const [orig] = n.reminderId ? await db().select().from(s.reminders).where(eq(s.reminders.id, n.reminderId)) : [null];
  const at = new Date(Date.now() + minutes * 60_000);
  await db().transaction(async (tx) => {
    await tx.insert(s.reminders).values({
      userId,
      kind: "custom",
      title: n.title,
      body: n.body,
      url: n.url,
      nextFireAt: at,
      channels: orig?.channels ?? ["in_app"],
    });
    await tx.update(s.notifications).set({ readAt: new Date(), dismissedAt: new Date() }).where(eq(s.notifications.id, id));
  });
  return at;
}

/** Notifications created after a given time that the client has not displayed yet. */
export function recentUnread(userId: string, since: Date) {
  return db()
    .select()
    .from(s.notifications)
    .where(
      and(
        eq(s.notifications.userId, userId),
        isNull(s.notifications.readAt),
        or(sql`${s.notifications.createdAt} > ${since}`),
      ),
    )
    .orderBy(desc(s.notifications.createdAt))
    .limit(20);
}
