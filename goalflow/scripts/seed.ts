/**
 * Demo data: `npm run db:seed`. Creates (or recreates) demo@goalflow.local with a goal hierarchy,
 * two weeks of tasks and focus sessions, notes and a journal entry, so every screen has something
 * to show. Refuses to run against NODE_ENV=production unless SEED_FORCE=1.
 */
import { eq } from "drizzle-orm";
import { addDays, localToInstant, periodContaining, todayIn } from "../src/lib/domain/periods";
import { TaskSchema } from "../src/lib/validation/task";
import { closeDb, db } from "../src/server/db/client";
import * as s from "../src/server/db/schema";
import { getPreferences, registerUser } from "../src/server/services/account";
import { createGoal, recordProgress } from "../src/server/services/goals";
import { createNote, journalFor, saveNote } from "../src/server/services/notes";
import { createTask, setTaskStatus } from "../src/server/services/tasks";
import { saveManualSession } from "../src/server/services/timer";

const EMAIL = process.env.SEED_EMAIL ?? "demo@goalflow.local";
const PASSWORD = process.env.SEED_PASSWORD ?? "goalflow-demo-password";
const TZ = process.env.SEED_TIMEZONE ?? "UTC";

async function main() {
  if (process.env.NODE_ENV === "production" && process.env.SEED_FORCE !== "1") {
    console.error("Refusing to seed a production database. Set SEED_FORCE=1 if you really mean it.");
    process.exit(1);
  }
  await db().delete(s.users).where(eq(s.users.email, EMAIL.toLowerCase()));
  const user = await registerUser({ name: "Demo User", email: EMAIL, password: PASSWORD, timezone: TZ });
  await db().update(s.userPreferences).set({ onboarded: true }).where(eq(s.userPreferences.userId, user.id));
  const prefs = (await getPreferences(user.id))!;
  const today = todayIn(TZ);
  const year = periodContaining("year", today, TZ);
  const half = periodContaining("half", today, TZ);
  const quarter = periodContaining("quarter", today, TZ);
  const month = periodContaining("month", today, TZ);
  const week = periodContaining("week", today, TZ, prefs.weekStartsOn);

  const base = { description: "", category: "education" as const, direction: "increase" as const, startValue: 0, currentValue: 0, priority: "high" as const, status: "active" as const, weight: 1 };
  // A week goal must sit inside its month, so clip weeks that cross a month boundary.
  const weekStart = week.start < month.start ? month.start : week.start;
  const weekEnd = week.end > month.end ? month.end : week.end;
  const yearGoal = await createGoal(user.id, { ...base, title: "Read 24 books", level: "year", parentId: null, startDate: year.start, targetDate: year.end, metricType: "numeric", unit: "books", targetValue: 24, estimatedHours: 240 });
  const halfGoal = await createGoal(user.id, { ...base, title: "Read 12 books", level: "half", parentId: yearGoal.id, startDate: half.start, targetDate: half.end, metricType: "numeric", unit: "books", targetValue: 12, estimatedHours: 120 });
  const qGoal = await createGoal(user.id, { ...base, title: "Read 6 books", level: "quarter", parentId: halfGoal.id, startDate: quarter.start, targetDate: quarter.end, metricType: "numeric", unit: "books", targetValue: 6, estimatedHours: 60 });
  const mGoal = await createGoal(user.id, { ...base, title: "Read 2 books", level: "month", parentId: qGoal.id, startDate: month.start, targetDate: month.end, metricType: "tasks", unit: "", targetValue: null, estimatedHours: 20 });
  const wGoal = await createGoal(user.id, { ...base, title: "Read 120 pages", level: "week", parentId: mGoal.id, startDate: weekStart, targetDate: weekEnd, metricType: "numeric", unit: "pages", targetValue: 120, estimatedHours: 5 });
  await recordProgress(user.id, yearGoal.id, 15, "Seed data");
  await recordProgress(user.id, wGoal.id, 45, "Seed data");
  const fitness = await createGoal(user.id, { ...base, title: "Run a half marathon", category: "health", level: "year", parentId: null, startDate: year.start, targetDate: year.end, metricType: "milestones", unit: "", targetValue: null, estimatedHours: 150 });

  // Two weeks of history plus the next few days.
  const plan: [number, string, string, number, string | null, "done" | "todo"][] = [];
  for (let d = -13; d <= 3; d++) {
    plan.push([d, "Read 30 pages", "07:00", 45, mGoal.id, d < 0 && d % 4 !== 0 ? "done" : "todo"]);
    if (d % 2 === 0) plan.push([d, "Run 5 km", "18:00", 40, fitness.id, d < 0 ? "done" : "todo"]);
  }
  plan.push([0, "Write book notes", "20:00", 30, mGoal.id, "todo"], [1, "Plan next month's reading list", "09:00", 30, qGoal.id, "todo"]);
  for (const [offset, title, time, minutes, goalId, status] of plan) {
    const date = addDays(today, offset);
    const t = await createTask(user.id, prefs, TaskSchema.parse({ title, scheduledStart: `${date}T${time}`, durationMinutes: String(minutes), estimatedMinutes: String(minutes), goalId: goalId ?? "", allowOverlap: "on" }));
    if (status === "done") {
      const start = localToInstant(date, time, TZ);
      const actual = Math.round(minutes * (0.8 + (Math.abs(offset * 7919) % 50) / 100));
      await saveManualSession(user.id, { taskId: t.id, startedAt: start, endedAt: new Date(start.getTime() + actual * 60_000), kind: "focus", note: "" });
      await setTaskStatus(user.id, prefs, t.id, "done");
      await db().update(s.tasks).set({ completedAt: new Date(start.getTime() + actual * 60_000) }).where(eq(s.tasks.id, t.id));
    }
  }

  const n = await createNote(user.id, { kind: "goal", title: "Reading list", body: "", goalId: yearGoal.id, taskId: null, workSessionId: null, reviewReportId: null });
  await saveNote(user.id, n.id, { title: "Reading list", body: "Atomic Habits\nThe Name of the Wind\nSapiens\nDeep Work", tags: ["reading", "ideas"], goalId: yearGoal.id, taskId: null });
  const j = await journalFor(user.id, addDays(today, -1));
  await saveNote(user.id, j.id, { title: j.title, body: "Good reading streak. Skipped the run because of rain; moved it to tomorrow.", tags: ["reflection"], goalId: null, taskId: null });

  console.log(`Seeded ${EMAIL} / ${PASSWORD} (timezone ${TZ}).`);
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
