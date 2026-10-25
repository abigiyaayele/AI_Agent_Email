-- Hierarchy guards: a goal may not become its own ancestor, and parent/child must belong to the same user.
CREATE OR REPLACE FUNCTION goalflow_check_goal_parent() RETURNS trigger AS $$
DECLARE
  parent_user uuid;
  cycle_found boolean;
BEGIN
  IF NEW.parent_id IS NULL THEN
    RETURN NEW;
  END IF;
  IF NEW.parent_id = NEW.id THEN
    RAISE EXCEPTION 'goal cannot be its own parent' USING ERRCODE = 'check_violation';
  END IF;
  SELECT user_id INTO parent_user FROM goals WHERE id = NEW.parent_id;
  IF parent_user IS DISTINCT FROM NEW.user_id THEN
    RAISE EXCEPTION 'parent goal belongs to another user' USING ERRCODE = 'check_violation';
  END IF;
  WITH RECURSIVE ancestors(id, parent_id, depth) AS (
    SELECT id, parent_id, 1 FROM goals WHERE id = NEW.parent_id
    UNION ALL
    SELECT g.id, g.parent_id, a.depth + 1 FROM goals g JOIN ancestors a ON g.id = a.parent_id WHERE a.depth < 50
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;
  IF cycle_found THEN
    RAISE EXCEPTION 'goal hierarchy cycle detected' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER goals_parent_guard BEFORE INSERT OR UPDATE OF parent_id ON goals
  FOR EACH ROW EXECUTE FUNCTION goalflow_check_goal_parent();
--> statement-breakpoint
CREATE OR REPLACE FUNCTION goalflow_check_task_parent() RETURNS trigger AS $$
DECLARE
  cycle_found boolean;
BEGIN
  IF NEW.parent_task_id IS NULL THEN
    RETURN NEW;
  END IF;
  WITH RECURSIVE ancestors(id, parent_task_id, depth) AS (
    SELECT id, parent_task_id, 1 FROM tasks WHERE id = NEW.parent_task_id
    UNION ALL
    SELECT t.id, t.parent_task_id, a.depth + 1 FROM tasks t JOIN ancestors a ON t.id = a.parent_task_id WHERE a.depth < 50
  )
  SELECT EXISTS (SELECT 1 FROM ancestors WHERE id = NEW.id) INTO cycle_found;
  IF cycle_found THEN
    RAISE EXCEPTION 'subtask cycle detected' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
--> statement-breakpoint
CREATE TRIGGER tasks_parent_guard BEFORE INSERT OR UPDATE OF parent_task_id ON tasks
  FOR EACH ROW EXECUTE FUNCTION goalflow_check_task_parent();
--> statement-breakpoint
ALTER TABLE work_sessions ADD CONSTRAINT work_sessions_time_order CHECK (ended_at IS NULL OR ended_at >= started_at);
--> statement-breakpoint
ALTER TABLE tasks ADD CONSTRAINT tasks_schedule_order CHECK (scheduled_end IS NULL OR scheduled_start IS NULL OR scheduled_end > scheduled_start);
--> statement-breakpoint
ALTER TABLE goals ADD CONSTRAINT goals_date_order CHECK (target_date >= start_date);
--> statement-breakpoint
-- Row-level security.
-- The GoalFlow server connects with its own (owner) role and scopes every query by the
-- authenticated user id. RLS is enabled as defence in depth: on Supabase, the anon/authenticated
-- roles used by the auto-generated Data API get no access at all unless a policy grants it,
-- and any connection that sets `app.user_id` (SET LOCAL app.user_id = '<uuid>') only sees its own rows.
DO $$
DECLARE
  t text;
BEGIN
  FOREACH t IN ARRAY ARRAY[
    'user_preferences','schedules','recurring_rules','goals','goal_milestones','progress_snapshots',
    'tasks','task_dependencies','task_checklist_items','work_sessions','reminders','notifications',
    'push_subscriptions','review_reports','notes','tags','audit_events','sessions'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', t);
    EXECUTE format(
      'CREATE POLICY %I ON %I USING (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid) WITH CHECK (user_id = nullif(current_setting(''app.user_id'', true), '''')::uuid)',
      t || '_owner', t
    );
  END LOOP;
END $$;
--> statement-breakpoint
ALTER TABLE users ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY users_self ON users USING (id = nullif(current_setting('app.user_id', true), '')::uuid);
--> statement-breakpoint
ALTER TABLE note_tags ENABLE ROW LEVEL SECURITY;
--> statement-breakpoint
CREATE POLICY note_tags_owner ON note_tags USING (
  EXISTS (SELECT 1 FROM notes n WHERE n.id = note_id AND n.user_id = nullif(current_setting('app.user_id', true), '')::uuid)
);
--> statement-breakpoint
ALTER TABLE rate_limits ENABLE ROW LEVEL SECURITY;
