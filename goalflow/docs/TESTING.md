# Testing GoalFlow

| Suite | Command | What it covers |
| --- | --- | --- |
| Type check | `npm run typecheck` | Strict TypeScript across app, scripts and tests |
| Unit | `npm run test:unit` | Pure domain logic: progress (incl. inverse goals and milestone weights), pace and forecasts, estimation, scheduling and overlap detection, rebalancing, recurrence, DST-safe periods, timer math, reminders, reviews, plan breakdown |
| Integration | `npm run test:integration` | Services against a real PostgreSQL database: auth and rate limiting, data export and account deletion, goal hierarchy rules, progress roll-up, guided plans, task scheduling conflicts, status transitions and dependencies, carry-over history, recurring task generation, focus timer (pause/resume, parallel-timer protection, corrections), timesheets across midnight, notes search/conflicts, exactly-once reminder delivery across DST, reviews and AI summaries (with a fake AI provider), assistant validation, analytics, and cross-user isolation |
| End-to-end | `npm run test:e2e` | Playwright in a desktop (1366×900) and a mobile (Pixel 7) browser: sign up / sign out / sign in, planning a day with overlap protection and the daily summary, calendar, focus timer surviving a reload, note autosave and search, reminders, plus an axe accessibility scan and a no-horizontal-scroll check on every main page |
| All but e2e | `npm test` | Unit + integration |

## Databases

Integration tests run against `TEST_DATABASE_URL`
(default `postgres://goalflow:goalflow@localhost:5432/goalflow_test`). They migrate it and truncate
all tables before each test, so **never point it at real data**.

```bash
createdb goalflow_test -O goalflow
npm test
```

## End-to-end tests

The e2e suite drives a production build:

```bash
npm run build
DATABASE_URL=postgres://goalflow:goalflow@localhost:5432/goalflow npm run test:e2e
```

Playwright starts `next start` on port 3100 (or reuses a server already running there). Each
run creates fresh accounts (one per device project) and clears the sign-up rate limiter first,
so repeated runs are fine. Use a development database, not production.

If your environment ships its own Chromium, set `PW_CHROMIUM_PATH` to its executable.

## AI in tests

No test calls a real AI service. Tests inject a fake provider with `setAiProviderForTesting`, which
lets them check both that valid AI output is used and that invalid or failed output falls back to
the built-in rules.
