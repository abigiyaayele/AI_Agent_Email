# GoalFlow

A personal operating system for turning long-term ambitions into daily action: yearly goals broken
down into six-month, quarterly, monthly and weekly targets, daily tasks with scheduling and
conflict detection, a focus timer, reminders, notes, period reviews, analytics and an optional AI
planning assistant.

## Quick start

Requirements: Node.js 20.9+ and PostgreSQL 14+ (local, Docker, or Supabase).

```bash
cd goalflow
npm install
cp .env.example .env          # set DATABASE_URL at minimum
npm run db:migrate
npm run dev                   # http://localhost:3000
```

Create a database locally if needed:

```bash
createuser goalflow --pwprompt && createdb goalflow -O goalflow
# or: docker run -d -p 5432:5432 -e POSTGRES_USER=goalflow -e POSTGRES_PASSWORD=goalflow postgres:16
```

## Scripts

| Command | What it does |
| --- | --- |
| `npm run dev` / `build` / `start` | Next.js dev server, production build, production server |
| `npm run db:migrate` | Apply SQL migrations in `drizzle/` |
| `npm run db:generate` | Generate a new migration after editing `src/server/db/schema.ts` |
| `npm run typecheck` | TypeScript strict type check |
| `npm test` | Unit + integration tests (integration uses `TEST_DATABASE_URL`, default `goalflow_test`) |
| `npm run test:e2e` | Playwright end-to-end tests (desktop + mobile viewports) |
| `npm run db:seed` | Create a demo account (`demo@goalflow.local` / `goalflow-demo-password`) with sample data |
| `npm run worker` | Standalone reminder worker (one of the reminder delivery options) |

## Features

- **Goals:** year → six months → quarter → month → week, with progress, pace and "expected by today".
- **Tasks:** statuses, priorities, dependencies, recurrence, estimates; list, board, calendar
  (day/week/month with drag and drop) and timeline views. Overlaps are blocked unless you choose
  "Schedule anyway". Unfinished work is carried over with its history, never deleted.
- **Workload:** daily capacity from your working hours, overload detection and a proposed
  rebalanced schedule you approve move by move. Critical deadlines are never moved automatically.
- **Focus timer:** survives refresh, Pomodoro mode, manual entries, audited corrections and
  timesheets with CSV export.
- **Reminders:** stored in the database, snooze and dismiss, time zone and DST safe, deduplicated.
  In-app notifications work whenever a tab is open; push and background delivery need the cron
  route or worker (see the deployment guide).
- **Notes and journal:** autosave with draft recovery, tags, favorites, full-text search, links to
  goals and tasks.
- **Reviews:** daily, weekly, monthly, quarterly, half-year and yearly reviews with reflections and a
  done / undone / time summary. The summary uses AI when `ANTHROPIC_API_KEY` is set and a built-in
  summary otherwise.
- **Analytics and assistant:** focus vs. plan, completion trend, estimate accuracy, goal history
  with drill-down; a rules-based assistant that always works, plus optional AI advice whose
  suggestions are validated and applied only after you approve them.
- **Account:** sessions with rate limiting, every query scoped to the signed-in user, JSON export
  and account deletion. Installable as a PWA with an offline page.

## Documentation

- [Setup](docs/SETUP.md): local install, environment variables, demo data
- [Testing](docs/TESTING.md): unit, integration and end-to-end tests
- [Deployment](docs/DEPLOYMENT.md): hosting, reminders in production, security checklist, backups
- [Architecture](docs/ARCHITECTURE.md): how the pieces fit together
