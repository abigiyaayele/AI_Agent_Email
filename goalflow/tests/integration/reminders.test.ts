import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TaskSchema } from "@/lib/validation/task";
import { closeDb, db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getPreferences } from "@/server/services/account";
import { createCustomReminder, listNotifications, markNotifications, processDueReminders, snoozeNotification, unreadCount } from "@/server/services/reminders";
import { createTask, setTaskStatus } from "@/server/services/tasks";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

async function setup(tz = "UTC") {
  const u = await makeUser(tz);
  // Silence the built-in planning reminders so each test only sees its own.
  await db().update(s.reminders).set({ active: false }).where(eq(s.reminders.userId, u.id));
  return { u, prefs: (await getPreferences(u.id))! };
}

describe("reminder delivery", () => {
  it("fires each occurrence exactly once, even with concurrent workers", async () => {
    const { u, prefs } = await setup();
    await createCustomReminder(u.id, prefs, { title: "Stretch", body: "", at: new Date("2026-11-02T09:00:00Z"), channels: ["in_app"], rule: null });
    const now = new Date("2026-11-02T09:00:30Z");
    const results = await Promise.all([processDueReminders({ now }), processDueReminders({ now }), processDueReminders({ now })]);
    expect(results.flat()).toHaveLength(1);
    expect(await processDueReminders({ now: new Date("2026-11-02T09:05:00Z") })).toHaveLength(0);
    expect(await listNotifications(u.id)).toHaveLength(1);
  });

  it("keeps local time for recurring reminders across a DST change", async () => {
    const { u, prefs } = await setup("Europe/London");
    // Daily 08:00 London, starting the Saturday before clocks go back (25 Oct 2026).
    await createCustomReminder(
      u.id,
      prefs,
      {
        title: "Morning pages",
        body: "",
        at: new Date(),
        channels: ["in_app"],
        rule: { freq: "daily", interval: 1, byWeekday: null, byMonthDay: null, startLocal: "2026-10-24T08:00", timezone: "Europe/London", untilDate: null, count: null },
      },
      new Date("2026-10-24T06:00:00Z"),
    );
    const fired: string[] = [];
    for (const iso of ["2026-10-24T07:00:30Z", "2026-10-25T08:00:30Z", "2026-10-26T08:00:30Z"]) {
      const n = await processDueReminders({ now: new Date(iso) });
      fired.push(...n.map((x) => x.fireKey.split(":").slice(1).join(":")));
    }
    // 08:00 BST = 07:00Z before the change, 08:00 GMT = 08:00Z after it.
    expect(fired).toEqual(["2026-10-24T07:00:00.000Z", "2026-10-25T08:00:00.000Z", "2026-10-26T08:00:00.000Z"]);
    const [r] = await db().select().from(s.reminders).where(and(eq(s.reminders.userId, u.id), eq(s.reminders.title, "Morning pages")));
    expect(r!.nextFireAt!.toISOString()).toBe("2026-10-27T08:00:00.000Z");
  });

  it("does not remind about tasks that are already done", async () => {
    const { u, prefs } = await setup();
    const t = await createTask(u.id, prefs, TaskSchema.parse({ title: "Pay rent", scheduledStart: "2026-11-02T10:00", durationMinutes: "15", startReminder: "15" }));
    await setTaskStatus(u.id, prefs, t.id, "done");
    expect(await processDueReminders({ now: new Date("2026-11-02T09:50:00Z") })).toHaveLength(0);
  });

  it("supports read, dismiss and snooze", async () => {
    const { u, prefs } = await setup();
    await createCustomReminder(u.id, prefs, { title: "Call", body: "", at: new Date(Date.now() - 1000), channels: ["in_app"], rule: null });
    const [n] = await processDueReminders();
    expect(await unreadCount(u.id)).toBe(1);
    const until = await snoozeNotification(u.id, n!.id, 10);
    expect(until!.getTime()).toBeGreaterThan(Date.now() + 9 * 60_000);
    expect(await unreadCount(u.id)).toBe(0);
    const again = await processDueReminders({ now: new Date(Date.now() + 11 * 60_000) });
    expect(again.map((x) => x.title)).toEqual(["Call"]);
    await markNotifications(u.id, "all", "dismiss");
    expect(await unreadCount(u.id)).toBe(0);
  });
});
