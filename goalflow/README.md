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

See [`docs/ARCHITECTURE.md`](docs/ARCHITECTURE.md) for the design.
