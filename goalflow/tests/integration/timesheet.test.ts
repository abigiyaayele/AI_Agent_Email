import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { TaskSchema } from "@/lib/validation/task";
import { closeDb } from "@/server/db/client";
import { getPreferences } from "@/server/services/account";
import { createTask } from "@/server/services/tasks";
import { saveManualSession } from "@/server/services/timer";
import { buildTimesheet, timesheetCsv } from "@/server/services/timesheet";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

describe("timesheet", () => {
  it("splits sessions across midnight in the user's zone and totals by task", async () => {
    const u = await makeUser("Europe/Berlin");
    const prefs = (await getPreferences(u.id))!;
    const t = await createTask(u.id, prefs, TaskSchema.parse({ title: "Thesis, chapter 2" }));
    // 22:30–01:30 Berlin time on 2026-11-02/03 (UTC+1)
    await saveManualSession(u.id, { taskId: t.id, startedAt: new Date("2026-11-02T21:30:00Z"), endedAt: new Date("2026-11-03T00:30:00Z"), kind: "focus", note: "late" });
    await saveManualSession(u.id, { taskId: null, startedAt: new Date("2026-11-03T08:00:00Z"), endedAt: new Date("2026-11-03T08:15:00Z"), kind: "break", note: "" });
    const sheet = await buildTimesheet(u.id, "Europe/Berlin", ["2026-11-02", "2026-11-03"]);
    expect(sheet.days.map((d) => d.focus)).toEqual([90, 90]);
    expect(sheet.focus).toBe(180);
    expect(sheet.breaks).toBe(15);
    expect(sheet.tasks[0]).toMatchObject({ label: "Thesis, chapter 2", focus: 180 });
    const csv = timesheetCsv(sheet.sessions, "Europe/Berlin");
    expect(csv.split("\n")[1]).toBe('2026-11-02,22:30,01:30,180,focus,manual,"Thesis, chapter 2",late');
  });

  it("only sees the user's own sessions", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await saveManualSession(a.id, { taskId: null, startedAt: new Date("2026-11-02T08:00:00Z"), endedAt: new Date("2026-11-02T09:00:00Z"), kind: "focus", note: "" });
    const sheet = await buildTimesheet(b.id, "UTC", ["2026-11-02"]);
    expect(sheet.sessions).toHaveLength(0);
  });
});
