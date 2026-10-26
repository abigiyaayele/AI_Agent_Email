# Deploying GoalFlow

GoalFlow is one Next.js app plus PostgreSQL. Reminders need *something* to run the dispatcher
periodically; pick the option that matches your host.

## Option A: Vercel (or Netlify) + managed Postgres

1. Create a Postgres database (Supabase, Neon, Vercel Postgres…). Copy its connection string.
2. Import the repository, set the project root to `goalflow/`.
3. Add environment variables from `.env.example` (at least `DATABASE_URL`, `APP_URL`,
   `CRON_SECRET`). Leave `INPROCESS_SCHEDULER` unset: serverless functions don't stay running.
4. Run migrations once from your machine (or a CI step) against the production database:
   `DATABASE_URL=… npm run db:migrate`.
5. Schedule reminder dispatch every minute (or every few minutes on free plans):
   - Vercel Cron, GitHub Actions or any cron service calling
     `curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://YOUR_APP/api/cron/reminders`

## Option B: A single server or container (VPS, Railway, Fly.io, Render)

```bash
npm ci
npm run build
npm run db:migrate
INPROCESS_SCHEDULER=true npm run start
```

With `INPROCESS_SCHEDULER=true` the web process dispatches reminders itself. If you run several
web instances, leave it off and run exactly one `npm run worker` process instead (running more is
safe, just unnecessary: reminders are claimed with row locks and de-duplicated by a unique key).

A `Dockerfile` and `docker-compose.yml` are included:

```bash
docker compose up -d --build                 # app on :3002, Postgres on a volume
docker compose exec app npm run db:migrate
```

Put HTTPS in front (Caddy, nginx, or your platform's proxy). Push notifications and installing
the PWA both require HTTPS.

## Optional services

- **Push notifications**: generate VAPID keys (`npx web-push generate-vapid-keys`), set the three
  `VAPID` variables, then each user turns on push per device in Settings. Browsers can still
  delay notifications when a device sleeps; every notification is also kept in the in-app inbox.
- **Email reminders**: set `EMAIL_PROVIDER=resend`, `RESEND_API_KEY` and a verified `EMAIL_FROM`.
- **AI**: set `AI_PROVIDER=anthropic` and `ANTHROPIC_API_KEY`. The key is only read on the server.
  Each user is limited to 30 AI requests per hour.

## Security checklist

- Serve only over HTTPS; session cookies are `Secure` in production.
- Keep `.env` and platform secrets out of the repository; rotate `CRON_SECRET` if it leaks.
- Use a database role that owns only the GoalFlow schema. Row-level security is enabled on all
  tables; on Supabase this also keeps the auto-generated Data API from exposing rows.
- Security headers (frame denial, no sniffing, strict referrer, a locked-down Permissions-Policy) are set in
  `next.config.ts`.

## Backups and recovery

**Database backups.** All user data lives in PostgreSQL.

- Managed Postgres: turn on the provider's daily backups and point-in-time recovery.
- Self-hosted: run a nightly dump and keep copies off the server, for example

  ```bash
  pg_dump --format=custom --no-owner "$DATABASE_URL" > goalflow-$(date +%F).dump
  ```

**Restore.**

```bash
createdb goalflow_restored
pg_restore --no-owner --dbname "postgres://…/goalflow_restored" goalflow-2026-10-25.dump
DATABASE_URL=postgres://…/goalflow_restored npm run db:migrate   # brings an older dump up to date
```

Then point `DATABASE_URL` at the restored database and restart. Test a restore at least once
before you need it.

**Per-user export.** Every user can download all of their data as JSON from Settings → Export
(`/api/export`) and a CSV timesheet from the Timesheet page. Deleting an account removes all of
that user's rows (cascading deletes).

**After an outage.** Reminders resume automatically: one-off reminders that came due while the
server was down fire once when it comes back, and recurring reminders skip ahead to their next
occurrence instead of replaying a backlog.
