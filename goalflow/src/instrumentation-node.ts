import { processDueReminders } from "./server/services/reminders";

const g = globalThis as typeof globalThis & { __gfScheduler?: NodeJS.Timeout };

export function startScheduler() {
  if (g.__gfScheduler) return;
  g.__gfScheduler = setInterval(() => {
    processDueReminders({ limit: 500 }).catch((err) => console.error("[scheduler] tick failed", err));
  }, 30_000);
  console.log("[scheduler] in-process reminder scheduler started");
}
