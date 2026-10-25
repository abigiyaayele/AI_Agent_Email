CREATE TYPE "public"."notification_channel" AS ENUM('in_app', 'push', 'email');--> statement-breakpoint
CREATE TYPE "public"."metric_direction" AS ENUM('increase', 'decrease');--> statement-breakpoint
CREATE TYPE "public"."goal_category" AS ENUM('career', 'education', 'business', 'personal', 'fitness', 'health', 'finances', 'relationships', 'other');--> statement-breakpoint
CREATE TYPE "public"."goal_level" AS ENUM('year', 'half', 'quarter', 'month', 'week');--> statement-breakpoint
CREATE TYPE "public"."goal_status" AS ENUM('not_started', 'active', 'on_hold', 'completed', 'abandoned');--> statement-breakpoint
CREATE TYPE "public"."metric_type" AS ENUM('numeric', 'milestones', 'children', 'tasks');--> statement-breakpoint
CREATE TYPE "public"."note_kind" AS ENUM('quick', 'journal', 'task', 'goal', 'session', 'review', 'reflection');--> statement-breakpoint
CREATE TYPE "public"."period_type" AS ENUM('day', 'week', 'month', 'quarter', 'half', 'year');--> statement-breakpoint
CREATE TYPE "public"."priority" AS ENUM('critical', 'high', 'medium', 'low');--> statement-breakpoint
CREATE TYPE "public"."recurrence_freq" AS ENUM('daily', 'weekly', 'monthly', 'yearly');--> statement-breakpoint
CREATE TYPE "public"."reminder_kind" AS ENUM('task_start', 'deadline', 'custom', 'daily_plan', 'daily_review', 'weekly_review', 'monthly_review', 'quarterly_review', 'half_review', 'yearly_review');--> statement-breakpoint
CREATE TYPE "public"."task_status" AS ENUM('todo', 'in_progress', 'done', 'blocked', 'deferred');--> statement-breakpoint
CREATE TABLE "audit_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"entity_type" text NOT NULL,
	"entity_id" uuid,
	"action" text NOT NULL,
	"data" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goal_milestones" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"title" text NOT NULL,
	"due_date" date,
	"weight" double precision DEFAULT 1 NOT NULL,
	"completed_at" timestamp with time zone,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "goals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"parent_id" uuid,
	"level" "goal_level" NOT NULL,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"category" "goal_category" DEFAULT 'personal' NOT NULL,
	"start_date" date NOT NULL,
	"target_date" date NOT NULL,
	"metric_type" "metric_type" DEFAULT 'numeric' NOT NULL,
	"unit" text DEFAULT '' NOT NULL,
	"direction" "metric_direction" DEFAULT 'increase' NOT NULL,
	"start_value" double precision DEFAULT 0 NOT NULL,
	"target_value" double precision,
	"current_value" double precision DEFAULT 0 NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"status" "goal_status" DEFAULT 'active' NOT NULL,
	"estimated_hours" double precision,
	"weight" double precision DEFAULT 1 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "note_tags" (
	"note_id" uuid NOT NULL,
	"tag_id" uuid NOT NULL,
	CONSTRAINT "note_tags_note_id_tag_id_pk" PRIMARY KEY("note_id","tag_id")
);
--> statement-breakpoint
CREATE TABLE "notes" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "note_kind" DEFAULT 'quick' NOT NULL,
	"title" text DEFAULT '' NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"goal_id" uuid,
	"task_id" uuid,
	"work_session_id" uuid,
	"review_report_id" uuid,
	"journal_date" date,
	"favorite" boolean DEFAULT false NOT NULL,
	"search" "tsvector" GENERATED ALWAYS AS (to_tsvector('simple', coalesce(title, '') || ' ' || coalesce(body, ''))) STORED,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "notifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"reminder_id" uuid,
	"fire_key" text NOT NULL,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text,
	"delivered_channels" "notification_channel"[] DEFAULT '{}'::notification_channel[] NOT NULL,
	"delivery_errors" jsonb,
	"read_at" timestamp with time zone,
	"dismissed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "progress_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid NOT NULL,
	"captured_at" timestamp with time zone DEFAULT now() NOT NULL,
	"value" double precision,
	"progress_pct" double precision NOT NULL,
	"source" text DEFAULT 'manual' NOT NULL,
	"note" text
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "rate_limits" (
	"key" text PRIMARY KEY NOT NULL,
	"window_start" timestamp with time zone NOT NULL,
	"count" integer DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "recurring_rules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"freq" "recurrence_freq" NOT NULL,
	"interval" integer DEFAULT 1 NOT NULL,
	"by_weekday" integer[],
	"by_month_day" integer,
	"start_local" text NOT NULL,
	"timezone" text NOT NULL,
	"until_date" date,
	"count" integer,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "reminders" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"kind" "reminder_kind" NOT NULL,
	"task_id" uuid,
	"goal_id" uuid,
	"title" text NOT NULL,
	"body" text DEFAULT '' NOT NULL,
	"url" text,
	"offset_minutes" integer,
	"recurring_rule_id" uuid,
	"next_fire_at" timestamp with time zone,
	"snoozed_until" timestamp with time zone,
	"channels" "notification_channel"[] DEFAULT '{in_app}'::notification_channel[] NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"last_fired_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "review_reports" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"period_type" "period_type" NOT NULL,
	"period_start" date NOT NULL,
	"period_end" date NOT NULL,
	"metrics" jsonb DEFAULT '{}'::jsonb NOT NULL,
	"summary" text DEFAULT '' NOT NULL,
	"summary_source" text DEFAULT 'none' NOT NULL,
	"wins" text DEFAULT '' NOT NULL,
	"obstacles" text DEFAULT '' NOT NULL,
	"lessons" text DEFAULT '' NOT NULL,
	"decisions" text DEFAULT '' NOT NULL,
	"next_priorities" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "schedules" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"label" text NOT NULL,
	"kind" text DEFAULT 'commitment' NOT NULL,
	"days" integer[] NOT NULL,
	"start_time" text NOT NULL,
	"end_time" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"token_hash" text NOT NULL,
	"expires_at" timestamp with time zone NOT NULL,
	"user_agent" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"last_seen_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "tags" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid NOT NULL,
	"title" text NOT NULL,
	"done" boolean DEFAULT false NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "task_dependencies" (
	"task_id" uuid NOT NULL,
	"depends_on_task_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	CONSTRAINT "task_dependencies_task_id_depends_on_task_id_pk" PRIMARY KEY("task_id","depends_on_task_id")
);
--> statement-breakpoint
CREATE TABLE "tasks" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"goal_id" uuid,
	"milestone_id" uuid,
	"parent_task_id" uuid,
	"title" text NOT NULL,
	"description" text DEFAULT '' NOT NULL,
	"notes" text DEFAULT '' NOT NULL,
	"status" "task_status" DEFAULT 'todo' NOT NULL,
	"priority" "priority" DEFAULT 'medium' NOT NULL,
	"scheduled_start" timestamp with time zone,
	"scheduled_end" timestamp with time zone,
	"due_at" timestamp with time zone,
	"estimated_minutes" integer,
	"remaining_minutes" integer,
	"actual_minutes" integer DEFAULT 0 NOT NULL,
	"allow_overlap" boolean DEFAULT false NOT NULL,
	"recurring_rule_id" uuid,
	"recurrence_parent_id" uuid,
	"carry_over_count" integer DEFAULT 0 NOT NULL,
	"sort_order" integer DEFAULT 0 NOT NULL,
	"completed_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "user_preferences" (
	"user_id" uuid PRIMARY KEY NOT NULL,
	"timezone" text DEFAULT 'UTC' NOT NULL,
	"theme" text DEFAULT 'system' NOT NULL,
	"week_starts_on" integer DEFAULT 1 NOT NULL,
	"working_days" integer[] DEFAULT '{1,2,3,4,5}'::integer[] NOT NULL,
	"available_hours_per_day" double precision DEFAULT 4 NOT NULL,
	"max_daily_hours" double precision DEFAULT 8 NOT NULL,
	"preferred_start" text DEFAULT '09:00' NOT NULL,
	"preferred_end" text DEFAULT '17:00' NOT NULL,
	"sleep_start" text DEFAULT '23:00' NOT NULL,
	"sleep_end" text DEFAULT '07:00' NOT NULL,
	"personal_hours_per_day" double precision DEFAULT 3 NOT NULL,
	"break_minutes" integer DEFAULT 10 NOT NULL,
	"buffer_minutes" integer DEFAULT 5 NOT NULL,
	"pomodoro_focus_minutes" integer DEFAULT 25 NOT NULL,
	"pomodoro_break_minutes" integer DEFAULT 5 NOT NULL,
	"allow_parallel_timers" boolean DEFAULT false NOT NULL,
	"daily_plan_time" text DEFAULT '08:00' NOT NULL,
	"daily_review_time" text DEFAULT '20:00' NOT NULL,
	"weekly_review_day" integer DEFAULT 7 NOT NULL,
	"default_channels" "notification_channel"[] DEFAULT '{in_app,push}'::notification_channel[] NOT NULL,
	"email_reminders" boolean DEFAULT false NOT NULL,
	"onboarded" boolean DEFAULT false NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text NOT NULL,
	"name" text DEFAULT '' NOT NULL,
	"password_hash" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "work_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"task_id" uuid,
	"kind" text DEFAULT 'focus' NOT NULL,
	"source" text DEFAULT 'timer' NOT NULL,
	"started_at" timestamp with time zone NOT NULL,
	"ended_at" timestamp with time zone,
	"paused_at" timestamp with time zone,
	"paused_ms" bigint DEFAULT 0 NOT NULL,
	"planned_minutes" integer,
	"note" text DEFAULT '' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goal_milestones" ADD CONSTRAINT "goal_milestones_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "goals" ADD CONSTRAINT "goals_parent_id_goals_id_fk" FOREIGN KEY ("parent_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_note_id_notes_id_fk" FOREIGN KEY ("note_id") REFERENCES "public"."notes"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "note_tags" ADD CONSTRAINT "note_tags_tag_id_tags_id_fk" FOREIGN KEY ("tag_id") REFERENCES "public"."tags"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_work_session_id_work_sessions_id_fk" FOREIGN KEY ("work_session_id") REFERENCES "public"."work_sessions"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notes" ADD CONSTRAINT "notes_review_report_id_review_reports_id_fk" FOREIGN KEY ("review_report_id") REFERENCES "public"."review_reports"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "notifications" ADD CONSTRAINT "notifications_reminder_id_reminders_id_fk" FOREIGN KEY ("reminder_id") REFERENCES "public"."reminders"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "progress_snapshots" ADD CONSTRAINT "progress_snapshots_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "recurring_rules" ADD CONSTRAINT "recurring_rules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "reminders" ADD CONSTRAINT "reminders_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "review_reports" ADD CONSTRAINT "review_reports_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "schedules" ADD CONSTRAINT "schedules_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "sessions" ADD CONSTRAINT "sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tags" ADD CONSTRAINT "tags_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_checklist_items" ADD CONSTRAINT "task_checklist_items_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_depends_on_task_id_tasks_id_fk" FOREIGN KEY ("depends_on_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "task_dependencies" ADD CONSTRAINT "task_dependencies_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_goal_id_goals_id_fk" FOREIGN KEY ("goal_id") REFERENCES "public"."goals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_milestone_id_goal_milestones_id_fk" FOREIGN KEY ("milestone_id") REFERENCES "public"."goal_milestones"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_parent_task_id_tasks_id_fk" FOREIGN KEY ("parent_task_id") REFERENCES "public"."tasks"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurring_rule_id_recurring_rules_id_fk" FOREIGN KEY ("recurring_rule_id") REFERENCES "public"."recurring_rules"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "tasks" ADD CONSTRAINT "tasks_recurrence_parent_id_tasks_id_fk" FOREIGN KEY ("recurrence_parent_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "work_sessions" ADD CONSTRAINT "work_sessions_task_id_tasks_id_fk" FOREIGN KEY ("task_id") REFERENCES "public"."tasks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audit_entity_idx" ON "audit_events" USING btree ("entity_type","entity_id");--> statement-breakpoint
CREATE INDEX "audit_user_idx" ON "audit_events" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "milestones_goal_idx" ON "goal_milestones" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "goals_user_idx" ON "goals" USING btree ("user_id","level");--> statement-breakpoint
CREATE INDEX "goals_parent_idx" ON "goals" USING btree ("parent_id");--> statement-breakpoint
CREATE INDEX "notes_user_idx" ON "notes" USING btree ("user_id","updated_at");--> statement-breakpoint
CREATE INDEX "notes_search_idx" ON "notes" USING gin ("search");--> statement-breakpoint
CREATE UNIQUE INDEX "notes_journal_day_idx" ON "notes" USING btree ("user_id","journal_date") WHERE "notes"."kind" = 'journal';--> statement-breakpoint
CREATE UNIQUE INDEX "notifications_fire_key_idx" ON "notifications" USING btree ("fire_key");--> statement-breakpoint
CREATE INDEX "notifications_user_idx" ON "notifications" USING btree ("user_id","created_at");--> statement-breakpoint
CREATE INDEX "snapshots_goal_idx" ON "progress_snapshots" USING btree ("goal_id","captured_at");--> statement-breakpoint
CREATE UNIQUE INDEX "push_endpoint_idx" ON "push_subscriptions" USING btree ("endpoint");--> statement-breakpoint
CREATE INDEX "reminders_due_idx" ON "reminders" USING btree ("next_fire_at") WHERE "reminders"."active" and "reminders"."next_fire_at" is not null;--> statement-breakpoint
CREATE INDEX "reminders_user_idx" ON "reminders" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "reminders_system_kind_idx" ON "reminders" USING btree ("user_id","kind") WHERE "reminders"."task_id" is null and "reminders"."goal_id" is null and "reminders"."kind" <> 'custom';--> statement-breakpoint
CREATE UNIQUE INDEX "reviews_period_idx" ON "review_reports" USING btree ("user_id","period_type","period_start");--> statement-breakpoint
CREATE INDEX "schedules_user_idx" ON "schedules" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "sessions_token_hash_idx" ON "sessions" USING btree ("token_hash");--> statement-breakpoint
CREATE INDEX "sessions_user_idx" ON "sessions" USING btree ("user_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tags_user_name_idx" ON "tags" USING btree ("user_id","name");--> statement-breakpoint
CREATE INDEX "checklist_task_idx" ON "task_checklist_items" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "tasks_user_status_idx" ON "tasks" USING btree ("user_id","status");--> statement-breakpoint
CREATE INDEX "tasks_user_start_idx" ON "tasks" USING btree ("user_id","scheduled_start");--> statement-breakpoint
CREATE INDEX "tasks_user_due_idx" ON "tasks" USING btree ("user_id","due_at");--> statement-breakpoint
CREATE INDEX "tasks_goal_idx" ON "tasks" USING btree ("goal_id");--> statement-breakpoint
CREATE INDEX "tasks_parent_idx" ON "tasks" USING btree ("parent_task_id");--> statement-breakpoint
CREATE UNIQUE INDEX "tasks_recurrence_instance_idx" ON "tasks" USING btree ("recurrence_parent_id","scheduled_start") WHERE "tasks"."recurrence_parent_id" is not null;--> statement-breakpoint
CREATE UNIQUE INDEX "users_email_lower_idx" ON "users" USING btree (lower("email"));--> statement-breakpoint
CREATE INDEX "sessions_user_started_idx" ON "work_sessions" USING btree ("user_id","started_at");--> statement-breakpoint
CREATE INDEX "work_sessions_task_idx" ON "work_sessions" USING btree ("task_id");--> statement-breakpoint
CREATE INDEX "work_sessions_active_idx" ON "work_sessions" USING btree ("user_id") WHERE "work_sessions"."ended_at" is null;