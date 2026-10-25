# GoalFlow architecture

GoalFlow is a single Next.js (App Router) application with a PostgreSQL database. It runs as one
Node.js process (plus an optional worker for reminders) and can be hosted anywhere Node runs.

```
Browser (React, PWA)
   │  server actions / route handlers (same origin, httpOnly session cookie)
   ▼
Next.js server ── src/app            pages, layouts, route handlers (UI + HTTP edge)
   │              src/server/actions  "use server" actions: auth check → Zod validation → service call
   │              src/server/services business operations, transactions, authorization by user id
   │              src/server/ai       AI provider adapter (Anthropic or built-in rules)
   │              src/server/notifications  push (Web Push/VAPID) and email adapters
   ▼
PostgreSQL ────── drizzle/            versioned SQL migrations (schema, triggers, RLS)
   ▲
Worker / cron ─── scripts/worker.ts, /api/cron/reminders   reminder dispatch
```

## Layers

| Layer | Location | Rules |
| --- | --- | --- |
| Domain logic | `src/lib/domain/*` | Pure TypeScript, no I/O. Progress, pace, scheduling, recurrence, timer math, reviews, plan breakdown. Unit tested. Shared by server and client so calculations are never duplicated. |
| Validation | `src/lib/validation/*` | Zod schemas for every mutating input. Used on the server; forms reuse field names. |
| Data access | `src/server/db/*` | Drizzle schema (`schema.ts`) and pooled client. |
| Services | `src/server/services/*` | Every function takes the authenticated `userId` and scopes every query by it. Multi-row changes run in transactions. Writes an audit trail. |
| Auth | `src/server/auth/*` | Email + password (bcrypt), opaque random session tokens (only SHA-256 hashes stored), httpOnly `SameSite=Lax` cookies, sliding 30-day expiry, Postgres-backed rate limiting. |
| Actions / API | `src/server/actions/*`, `src/app/api/*` | Resolve the user from the session (never from the client), validate, call services, revalidate. |
| UI | `src/app/(app)/*`, `src/components/*` | Server components fetch data; client components only where interaction needs it (timer, drag and drop, forms, charts). |

## Why not Supabase Auth?

The spec suggests Supabase for Postgres and auth. GoalFlow uses **plain PostgreSQL** (Supabase
works as the database: paste its connection string) with **built-in session auth**. Trade-offs:

- + Runs locally and in CI with any Postgres, no vendor emulator; tests exercise the real auth code.
- + Hosting, database and auth providers can change independently.
- − No social login or magic links out of the box (can be added in `src/server/auth`).
- RLS is still enabled on every table (see `drizzle/0001_guards_and_rls.sql`). On Supabase this
  blocks the auto-generated Data API from exposing rows; any connection that sets
  `app.user_id` only sees that user's rows. The app server's own role scopes queries itself and
  integration tests verify isolation.

## Key design decisions

- **Goal hierarchy**: one `goals` table with `level` (year → half → quarter → month → week) and an
  explicit `parent_id`. The service validates levels, date windows and cycles; a database trigger
  rejects cycles and cross-user parents as a second line of defence.
- **Progress**: explicit per-goal `metric_type` — measured value (supports lower-is-better),
  weighted milestones, weighted roll-up from children, or linked tasks weighted by effort. Every
  number carries a plain-language explanation and an "assumption" flag.
- **Time**: instants are `timestamptz` (UTC); calendar dates are `date`. All period math runs in the
  user's IANA time zone with Luxon, so DST days are 23/25 hours and recurring reminders keep their
  wall-clock time.
- **Timer**: state is stored as timestamps (`started_at`, `paused_at`, `paused_ms`, `ended_at`),
  so refreshes, closed tabs and device switches never lose time. A row lock prevents accidental
  parallel timers.
- **Reminders**: each reminder stores its `next_fire_at`. The dispatcher claims due rows with
  `FOR UPDATE SKIP LOCKED` and inserts notifications with a unique `fire_key`
  (`reminder id + occurrence time`), so retries and concurrent workers never duplicate.
- **AI**: an adapter interface with an Anthropic implementation and a deterministic rules
  implementation. Outputs are validated with Zod and checked (dates in range, durations sane,
  parent links valid) before anything is shown; nothing is saved without explicit approval.

## Data model

See `src/server/db/schema.ts`. Tables: users, sessions, rate_limits, user_preferences, schedules,
recurring_rules, goals, goal_milestones, progress_snapshots, tasks, task_dependencies,
task_checklist_items, work_sessions, reminders, notifications, push_subscriptions, notes, tags,
note_tags, review_reports, audit_events.
