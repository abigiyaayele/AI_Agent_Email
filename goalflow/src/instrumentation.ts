/**
 * Optional in-process reminder scheduler for single-server deployments (INPROCESS_SCHEDULER=true).
 * Serverless hosts should use /api/cron/reminders or `npm run worker` instead.
 */
export async function register() {
  if (process.env.NEXT_RUNTIME === "nodejs") {
    if (process.env.INPROCESS_SCHEDULER === "true") {
      const { startScheduler } = await import("./instrumentation-node");
      startScheduler();
    }
  }
}
