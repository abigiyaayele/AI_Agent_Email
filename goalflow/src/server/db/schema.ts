import { sql } from "drizzle-orm";
import {
  boolean,
  customType,
  date,
  doublePrecision,
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  bigint,
  type AnyPgColumn,
} from "drizzle-orm/pg-core";
import {
  CHANNELS,
  DIRECTIONS,
  GOAL_CATEGORIES,
  GOAL_LEVELS,
  GOAL_STATUSES,
  METRIC_TYPES,
  NOTE_KINDS,
  PERIOD_TYPES,
  PRIORITIES,
  RECURRENCE_FREQS,
  REMINDER_KINDS,
  TASK_STATUSES,
} from "@/lib/constants";

const tsvector = customType<{ data: string }>({ dataType: () => "tsvector" });

const id = () => uuid("id").primaryKey().defaultRandom();
const createdAt = () => timestamp("created_at", { withTimezone: true }).notNull().defaultNow();
const updatedAt = () =>
  timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow()
    .$onUpdate(() => new Date());

export const goalLevel = pgEnum("goal_level", GOAL_LEVELS);
export const goalCategory = pgEnum("goal_category", GOAL_CATEGORIES);
export const goalStatus = pgEnum("goal_status", GOAL_STATUSES);
export const metricType = pgEnum("metric_type", METRIC_TYPES);
export const direction = pgEnum("metric_direction", DIRECTIONS);
export const priority = pgEnum("priority", PRIORITIES);
export const taskStatus = pgEnum("task_status", TASK_STATUSES);
export const periodType = pgEnum("period_type", PERIOD_TYPES);
export const reminderKind = pgEnum("reminder_kind", REMINDER_KINDS);
export const noteKind = pgEnum("note_kind", NOTE_KINDS);
export const recurrenceFreq = pgEnum("recurrence_freq", RECURRENCE_FREQS);
export const channel = pgEnum("notification_channel", CHANNELS);

// ---------------------------------------------------------------- identity

export const users = pgTable(
  "users",
  {
    id: id(),
    email: text("email").notNull(),
    name: text("name").notNull().default(""),
    passwordHash: text("password_hash").notNull(),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("users_email_lower_idx").on(sql`lower(${t.email})`)],
);

export const sessions = pgTable(
  "sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    tokenHash: text("token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    userAgent: text("user_agent"),
    createdAt: createdAt(),
    lastSeenAt: timestamp("last_seen_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [uniqueIndex("sessions_token_hash_idx").on(t.tokenHash), index("sessions_user_idx").on(t.userId)],
);

export const rateLimits = pgTable("rate_limits", {
  key: text("key").primaryKey(),
  windowStart: timestamp("window_start", { withTimezone: true }).notNull(),
  count: integer("count").notNull().default(0),
});

export type Commitment = { label: string; days: number[]; start: string; end: string };

export const userPreferences = pgTable("user_preferences", {
  userId: uuid("user_id")
    .primaryKey()
    .references(() => users.id, { onDelete: "cascade" }),
  timezone: text("timezone").notNull().default("UTC"),
  theme: text("theme", { enum: ["system", "light", "dark"] }).notNull().default("system"),
  /** 1 = Monday ... 7 = Sunday (ISO). */
  weekStartsOn: integer("week_starts_on").notNull().default(1),
  /** ISO weekdays the user works on. */
  workingDays: integer("working_days").array().notNull().default(sql`'{1,2,3,4,5}'::integer[]`),
  availableHoursPerDay: doublePrecision("available_hours_per_day").notNull().default(4),
  maxDailyHours: doublePrecision("max_daily_hours").notNull().default(8),
  preferredStart: text("preferred_start").notNull().default("09:00"),
  preferredEnd: text("preferred_end").notNull().default("17:00"),
  sleepStart: text("sleep_start").notNull().default("23:00"),
  sleepEnd: text("sleep_end").notNull().default("07:00"),
  personalHoursPerDay: doublePrecision("personal_hours_per_day").notNull().default(3),
  breakMinutes: integer("break_minutes").notNull().default(10),
  bufferMinutes: integer("buffer_minutes").notNull().default(5),
  pomodoroFocusMinutes: integer("pomodoro_focus_minutes").notNull().default(25),
  pomodoroBreakMinutes: integer("pomodoro_break_minutes").notNull().default(5),
  allowParallelTimers: boolean("allow_parallel_timers").notNull().default(false),
  dailyPlanTime: text("daily_plan_time").notNull().default("08:00"),
  dailyReviewTime: text("daily_review_time").notNull().default("20:00"),
  weeklyReviewDay: integer("weekly_review_day").notNull().default(7),
  defaultChannels: channel("default_channels").array().notNull().default(sql`'{in_app,push}'::notification_channel[]`),
  emailReminders: boolean("email_reminders").notNull().default(false),
  onboarded: boolean("onboarded").notNull().default(false),
  updatedAt: updatedAt(),
});

/** Recurring commitments and availability blocks (classes, meetings, gym...). */
export const schedules = pgTable(
  "schedules",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    label: text("label").notNull(),
    kind: text("kind", { enum: ["commitment", "focus_block"] }).notNull().default("commitment"),
    /** ISO weekdays this block repeats on. */
    days: integer("days").array().notNull(),
    startTime: text("start_time").notNull(),
    endTime: text("end_time").notNull(),
    createdAt: createdAt(),
  },
  (t) => [index("schedules_user_idx").on(t.userId)],
);

export const recurringRules = pgTable("recurring_rules", {
  id: id(),
  userId: uuid("user_id")
    .notNull()
    .references(() => users.id, { onDelete: "cascade" }),
  freq: recurrenceFreq("freq").notNull(),
  interval: integer("interval").notNull().default(1),
  /** ISO weekdays for weekly rules. */
  byWeekday: integer("by_weekday").array(),
  byMonthDay: integer("by_month_day"),
  /** Local wall-clock start (date + time) interpreted in `timezone`. */
  startLocal: text("start_local").notNull(),
  timezone: text("timezone").notNull(),
  untilDate: date("until_date"),
  count: integer("count"),
  createdAt: createdAt(),
});

// ---------------------------------------------------------------- goals

export const goals = pgTable(
  "goals",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    parentId: uuid("parent_id").references((): AnyPgColumn => goals.id, { onDelete: "set null" }),
    level: goalLevel("level").notNull(),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    category: goalCategory("category").notNull().default("personal"),
    startDate: date("start_date").notNull(),
    targetDate: date("target_date").notNull(),
    metricType: metricType("metric_type").notNull().default("numeric"),
    unit: text("unit").notNull().default(""),
    direction: direction("direction").notNull().default("increase"),
    startValue: doublePrecision("start_value").notNull().default(0),
    targetValue: doublePrecision("target_value"),
    currentValue: doublePrecision("current_value").notNull().default(0),
    priority: priority("priority").notNull().default("medium"),
    status: goalStatus("status").notNull().default("active"),
    estimatedHours: doublePrecision("estimated_hours"),
    /** Contribution weight towards the parent goal's roll-up progress. */
    weight: doublePrecision("weight").notNull().default(1),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("goals_user_idx").on(t.userId, t.level),
    index("goals_parent_idx").on(t.parentId),
  ],
);

export const goalMilestones = pgTable(
  "goal_milestones",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    dueDate: date("due_date"),
    weight: doublePrecision("weight").notNull().default(1),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("milestones_goal_idx").on(t.goalId)],
);

export const progressSnapshots = pgTable(
  "progress_snapshots",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    capturedAt: timestamp("captured_at", { withTimezone: true }).notNull().defaultNow(),
    value: doublePrecision("value"),
    progressPct: doublePrecision("progress_pct").notNull(),
    source: text("source", { enum: ["manual", "auto"] }).notNull().default("manual"),
    note: text("note"),
  },
  (t) => [index("snapshots_goal_idx").on(t.goalId, t.capturedAt)],
);

// ---------------------------------------------------------------- tasks

export const tasks = pgTable(
  "tasks",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    milestoneId: uuid("milestone_id").references(() => goalMilestones.id, { onDelete: "set null" }),
    parentTaskId: uuid("parent_task_id").references((): AnyPgColumn => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    description: text("description").notNull().default(""),
    notes: text("notes").notNull().default(""),
    status: taskStatus("status").notNull().default("todo"),
    priority: priority("priority").notNull().default("medium"),
    scheduledStart: timestamp("scheduled_start", { withTimezone: true }),
    scheduledEnd: timestamp("scheduled_end", { withTimezone: true }),
    dueAt: timestamp("due_at", { withTimezone: true }),
    estimatedMinutes: integer("estimated_minutes"),
    /** Optional manual override of remaining effort; otherwise estimated - actual. */
    remainingMinutes: integer("remaining_minutes"),
    /** Cached sum of focus work-session minutes (kept in sync by the timer service). */
    actualMinutes: integer("actual_minutes").notNull().default(0),
    allowOverlap: boolean("allow_overlap").notNull().default(false),
    recurringRuleId: uuid("recurring_rule_id").references(() => recurringRules.id, { onDelete: "set null" }),
    /** For generated recurring instances, the template task. */
    recurrenceParentId: uuid("recurrence_parent_id").references((): AnyPgColumn => tasks.id, {
      onDelete: "set null",
    }),
    carryOverCount: integer("carry_over_count").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    completedAt: timestamp("completed_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("tasks_user_status_idx").on(t.userId, t.status),
    index("tasks_user_start_idx").on(t.userId, t.scheduledStart),
    index("tasks_user_due_idx").on(t.userId, t.dueAt),
    index("tasks_goal_idx").on(t.goalId),
    index("tasks_parent_idx").on(t.parentTaskId),
    uniqueIndex("tasks_recurrence_instance_idx")
      .on(t.recurrenceParentId, t.scheduledStart)
      .where(sql`${t.recurrenceParentId} is not null`),
  ],
);

export const taskDependencies = pgTable(
  "task_dependencies",
  {
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    dependsOnTaskId: uuid("depends_on_task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.taskId, t.dependsOnTaskId] })],
);

export const taskChecklistItems = pgTable(
  "task_checklist_items",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id")
      .notNull()
      .references(() => tasks.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    done: boolean("done").notNull().default(false),
    sortOrder: integer("sort_order").notNull().default(0),
    createdAt: createdAt(),
  },
  (t) => [index("checklist_task_idx").on(t.taskId)],
);

export const workSessions = pgTable(
  "work_sessions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    kind: text("kind", { enum: ["focus", "break"] }).notNull().default("focus"),
    source: text("source", { enum: ["timer", "pomodoro", "manual"] }).notNull().default("timer"),
    startedAt: timestamp("started_at", { withTimezone: true }).notNull(),
    endedAt: timestamp("ended_at", { withTimezone: true }),
    /** When set, the session is currently paused since this instant. */
    pausedAt: timestamp("paused_at", { withTimezone: true }),
    /** Total paused milliseconds accumulated before `pausedAt`. */
    pausedMs: bigint("paused_ms", { mode: "number" }).notNull().default(0),
    /** Planned length for pomodoro sessions. */
    plannedMinutes: integer("planned_minutes"),
    note: text("note").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("sessions_user_started_idx").on(t.userId, t.startedAt),
    index("work_sessions_task_idx").on(t.taskId),
    index("work_sessions_active_idx").on(t.userId).where(sql`${t.endedAt} is null`),
  ],
);

// ---------------------------------------------------------------- reminders

export const reminders = pgTable(
  "reminders",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: reminderKind("kind").notNull(),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "cascade" }),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "cascade" }),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    url: text("url"),
    /** Minutes before the task start / deadline (task-relative reminders). */
    offsetMinutes: integer("offset_minutes"),
    recurringRuleId: uuid("recurring_rule_id").references(() => recurringRules.id, { onDelete: "set null" }),
    /** Next instant this reminder is due (UTC). Null when finished. */
    nextFireAt: timestamp("next_fire_at", { withTimezone: true }),
    snoozedUntil: timestamp("snoozed_until", { withTimezone: true }),
    channels: channel("channels").array().notNull().default(sql`'{in_app}'::notification_channel[]`),
    active: boolean("active").notNull().default(true),
    lastFiredAt: timestamp("last_fired_at", { withTimezone: true }),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("reminders_due_idx").on(t.nextFireAt).where(sql`${t.active} and ${t.nextFireAt} is not null`),
    index("reminders_user_idx").on(t.userId),
    uniqueIndex("reminders_system_kind_idx")
      .on(t.userId, t.kind)
      .where(sql`${t.taskId} is null and ${t.goalId} is null and ${t.kind} <> 'custom'`),
  ],
);

export const notifications = pgTable(
  "notifications",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    reminderId: uuid("reminder_id").references(() => reminders.id, { onDelete: "set null" }),
    /** Idempotency key: one notification per reminder occurrence, even if a job retries. */
    fireKey: text("fire_key").notNull(),
    title: text("title").notNull(),
    body: text("body").notNull().default(""),
    url: text("url"),
    deliveredChannels: channel("delivered_channels").array().notNull().default(sql`'{}'::notification_channel[]`),
    deliveryErrors: jsonb("delivery_errors").$type<Record<string, string>>(),
    readAt: timestamp("read_at", { withTimezone: true }),
    dismissedAt: timestamp("dismissed_at", { withTimezone: true }),
    createdAt: createdAt(),
  },
  (t) => [
    uniqueIndex("notifications_fire_key_idx").on(t.fireKey),
    index("notifications_user_idx").on(t.userId, t.createdAt),
  ],
);

export const pushSubscriptions = pgTable(
  "push_subscriptions",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    endpoint: text("endpoint").notNull(),
    p256dh: text("p256dh").notNull(),
    auth: text("auth").notNull(),
    createdAt: createdAt(),
  },
  (t) => [uniqueIndex("push_endpoint_idx").on(t.endpoint)],
);

// ---------------------------------------------------------------- notes

export const reviewReports = pgTable(
  "review_reports",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    periodType: periodType("period_type").notNull(),
    periodStart: date("period_start").notNull(),
    periodEnd: date("period_end").notNull(),
    /** Snapshot of computed metrics at the time the review was saved. */
    metrics: jsonb("metrics").$type<Record<string, unknown>>().notNull().default({}),
    summary: text("summary").notNull().default(""),
    summarySource: text("summary_source", { enum: ["none", "rules", "ai"] }).notNull().default("none"),
    wins: text("wins").notNull().default(""),
    obstacles: text("obstacles").notNull().default(""),
    lessons: text("lessons").notNull().default(""),
    decisions: text("decisions").notNull().default(""),
    nextPriorities: text("next_priorities").notNull().default(""),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [uniqueIndex("reviews_period_idx").on(t.userId, t.periodType, t.periodStart)],
);

export const notes = pgTable(
  "notes",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    kind: noteKind("kind").notNull().default("quick"),
    title: text("title").notNull().default(""),
    body: text("body").notNull().default(""),
    goalId: uuid("goal_id").references(() => goals.id, { onDelete: "set null" }),
    taskId: uuid("task_id").references(() => tasks.id, { onDelete: "set null" }),
    workSessionId: uuid("work_session_id").references(() => workSessions.id, { onDelete: "set null" }),
    reviewReportId: uuid("review_report_id").references(() => reviewReports.id, { onDelete: "set null" }),
    journalDate: date("journal_date"),
    favorite: boolean("favorite").notNull().default(false),
    search: tsvector("search").generatedAlwaysAs(
      sql`to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))`,
    ),
    createdAt: createdAt(),
    updatedAt: updatedAt(),
  },
  (t) => [
    index("notes_user_idx").on(t.userId, t.updatedAt),
    index("notes_search_idx").using("gin", t.search),
    uniqueIndex("notes_journal_day_idx").on(t.userId, t.journalDate).where(sql`${t.kind} = 'journal'`),
  ],
);

export const tags = pgTable(
  "tags",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    name: text("name").notNull(),
  },
  (t) => [uniqueIndex("tags_user_name_idx").on(t.userId, t.name)],
);

export const noteTags = pgTable(
  "note_tags",
  {
    noteId: uuid("note_id")
      .notNull()
      .references(() => notes.id, { onDelete: "cascade" }),
    tagId: uuid("tag_id")
      .notNull()
      .references(() => tags.id, { onDelete: "cascade" }),
  },
  (t) => [primaryKey({ columns: [t.noteId, t.tagId] })],
);

// ---------------------------------------------------------------- audit

export const auditEvents = pgTable(
  "audit_events",
  {
    id: id(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    entityType: text("entity_type").notNull(),
    entityId: uuid("entity_id"),
    action: text("action").notNull(),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    createdAt: createdAt(),
  },
  (t) => [index("audit_entity_idx").on(t.entityType, t.entityId), index("audit_user_idx").on(t.userId, t.createdAt)],
);

export type User = typeof users.$inferSelect;
export type Preferences = typeof userPreferences.$inferSelect;
export type Goal = typeof goals.$inferSelect;
export type Milestone = typeof goalMilestones.$inferSelect;
export type Task = typeof tasks.$inferSelect;
export type WorkSession = typeof workSessions.$inferSelect;
export type Reminder = typeof reminders.$inferSelect;
export type Notification = typeof notifications.$inferSelect;
export type Note = typeof notes.$inferSelect;
export type ReviewReport = typeof reviewReports.$inferSelect;
export type Schedule = typeof schedules.$inferSelect;
export type RecurringRule = typeof recurringRules.$inferSelect;
export type Snapshot = typeof progressSnapshots.$inferSelect;
