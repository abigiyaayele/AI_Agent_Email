# Setting up GoalFlow

## 1. Requirements

- Node.js 20.9 or newer
- PostgreSQL 14 or newer (local install, Docker, Supabase, Neon, RDS… any will do)

## 2. Install

```bash
cd goalflow
npm install
cp .env.example .env
```

Edit `.env`. Only `DATABASE_URL` is required to run the app; everything else switches on optional
features. The file is git-ignored: never commit it.

| Variable | Needed for | Notes |
| --- | --- | --- |
| `DATABASE_URL` | everything | `postgres://user:password@host:5432/db`. On Supabase use the session pooler or direct connection string. |
| `APP_URL` | links in emails and push notifications | e.g. `https://goalflow.example.com` |
| `CRON_SECRET` | `/api/cron/reminders` | `openssl rand -hex 32` |
| `INPROCESS_SCHEDULER` | reminders on a single long-running server | `true` runs the reminder dispatcher every 30 s inside the web server |
| `NEXT_PUBLIC_VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` | push notifications | `npx web-push generate-vapid-keys` |
| `EMAIL_PROVIDER`, `RESEND_API_KEY`, `EMAIL_FROM` | email reminders | `resend`, or `console` to print emails to the server log |
| `AI_PROVIDER`, `ANTHROPIC_API_KEY`, `AI_MODEL` | AI planning, summaries and assistant | Without a key GoalFlow uses its built-in rules for all of these |

If a required variable is missing or malformed, every page shows a setup screen that names it
instead of crashing.

## 3. Create the database

```bash
# Local Postgres
createuser goalflow --pwprompt
createdb goalflow -O goalflow

# Or Docker
docker run -d --name goalflow-db -p 5432:5432 \
  -e POSTGRES_USER=goalflow -e POSTGRES_PASSWORD=goalflow -e POSTGRES_DB=goalflow postgres:16
```

Apply the migrations (safe to run repeatedly):

```bash
npm run db:migrate
```

## 4. Run

```bash
npm run dev          # http://localhost:3000
```

Optional demo data, so every screen has something to show:

```bash
npm run db:seed      # demo@goalflow.local / goalflow-demo-password
```

The seed script deletes and recreates only the demo account, and refuses to run when
`NODE_ENV=production` unless `SEED_FORCE=1`.

## 5. First steps in the app

1. Register. You land on Settings: set your time zone, working days, hours per day and planning
   and review times. These drive capacity, pace and reminders.
2. Open **Goal Hierarchy → Guided breakdown** and turn a yearly goal into half-year, quarterly,
   monthly and weekly targets plus first-week tasks. Review and edit the draft; nothing is saved
   until you approve it.
3. Use **My Day** each morning and the **End-of-day review** (with the daily summary) each evening.

## Reminders while developing

With `npm run dev`, reminders fire whenever a GoalFlow tab is open (each tab checks once a minute).
To test closed-tab delivery run the worker in a second terminal:

```bash
npm run worker
```

## Changing the schema

1. Edit `src/server/db/schema.ts`.
2. `npm run db:generate` to create a new SQL migration in `drizzle/`.
3. Review the SQL, then `npm run db:migrate`.

Hand-written SQL (triggers, constraints, row-level security) lives in its own migration files in
`drizzle/` and is applied in order with the generated ones.
