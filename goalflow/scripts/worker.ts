/**
 * Long-running reminder worker: `npm run worker`. Use this when you host GoalFlow on a server
 * (Docker, VM, Railway, Fly). Safe to run several copies; rows are claimed with SKIP LOCKED and
 * each occurrence has a unique fire key, so nothing is sent twice.
 */
import { closeDb } from "@/server/db/client";
import { processDueReminders } from "@/server/services/reminders";

const INTERVAL_MS = Number(process.env.WORKER_INTERVAL_MS ?? 30_000);
let stopping = false;

async function tick() {
  try {
    const fired = await processDueReminders({ limit: 500 });
    if (fired.length) console.log(`[worker] ${new Date().toISOString()} fired ${fired.length} reminder(s)`);
  } catch (err) {
    console.error("[worker] tick failed", err);
  }
}

async function main() {
  console.log(`[worker] started, checking every ${INTERVAL_MS / 1000}s`);
  while (!stopping) {
    await tick();
    await new Promise((r) => setTimeout(r, INTERVAL_MS));
  }
  await closeDb();
}

for (const sig of ["SIGINT", "SIGTERM"] as const) process.on(sig, () => (stopping = true));
main();
