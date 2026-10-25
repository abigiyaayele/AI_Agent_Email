// Shared enumerations used by the database schema, validation and UI.

export const GOAL_LEVELS = ["year", "half", "quarter", "month", "week"] as const;
export type GoalLevel = (typeof GOAL_LEVELS)[number];
export const GOAL_LEVEL_LABEL: Record<GoalLevel, string> = {
  year: "Yearly goal",
  half: "Six-month milestone",
  quarter: "Three-month milestone",
  month: "Monthly goal",
  week: "Weekly goal",
};

export const GOAL_CATEGORIES = [
  "career",
  "education",
  "business",
  "personal",
  "fitness",
  "health",
  "finances",
  "relationships",
  "other",
] as const;
export type GoalCategory = (typeof GOAL_CATEGORIES)[number];

export const GOAL_STATUSES = ["not_started", "active", "on_hold", "completed", "abandoned"] as const;
export type GoalStatus = (typeof GOAL_STATUSES)[number];

/** How a goal's progress is measured. */
export const METRIC_TYPES = ["numeric", "milestones", "children", "tasks"] as const;
export type MetricType = (typeof METRIC_TYPES)[number];
export const METRIC_TYPE_LABEL: Record<MetricType, string> = {
  numeric: "Measured value (current vs target)",
  milestones: "Weighted milestones",
  children: "Roll up from child goals",
  tasks: "Linked tasks (weighted by effort)",
};

export const DIRECTIONS = ["increase", "decrease"] as const;
export type Direction = (typeof DIRECTIONS)[number];

export const PRIORITIES = ["critical", "high", "medium", "low"] as const;
export type Priority = (typeof PRIORITIES)[number];
export const PRIORITY_RANK: Record<Priority, number> = { critical: 0, high: 1, medium: 2, low: 3 };

export const TASK_STATUSES = ["todo", "in_progress", "done", "blocked", "deferred"] as const;
export type TaskStatus = (typeof TASK_STATUSES)[number];
export const TASK_STATUS_LABEL: Record<TaskStatus, string> = {
  todo: "To Do",
  in_progress: "In Progress",
  done: "Done",
  blocked: "Blocked",
  deferred: "Deferred",
};

export const PERIOD_TYPES = ["day", "week", "month", "quarter", "half", "year"] as const;
export type PeriodType = (typeof PERIOD_TYPES)[number];
export const PERIOD_LABEL: Record<PeriodType, string> = {
  day: "Daily",
  week: "Weekly",
  month: "Monthly",
  quarter: "Quarterly",
  half: "Six-month",
  year: "Yearly",
};

export const REMINDER_KINDS = [
  "task_start",
  "deadline",
  "custom",
  "daily_plan",
  "daily_review",
  "weekly_review",
  "monthly_review",
  "quarterly_review",
  "half_review",
  "yearly_review",
] as const;
export type ReminderKind = (typeof REMINDER_KINDS)[number];

export const CHANNELS = ["in_app", "push", "email"] as const;
export type Channel = (typeof CHANNELS)[number];
export const CHANNEL_LABEL: Record<Channel, string> = { in_app: "In-app", push: "Push / browser", email: "Email" };

export const NOTE_KINDS = ["quick", "journal", "task", "goal", "session", "review", "reflection"] as const;
export type NoteKind = (typeof NOTE_KINDS)[number];

export const RECURRENCE_FREQS = ["daily", "weekly", "monthly", "yearly"] as const;
export type RecurrenceFreq = (typeof RECURRENCE_FREQS)[number];
