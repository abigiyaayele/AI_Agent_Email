import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { TaskSchema } from "@/lib/validation/task";
import { setAiProviderForTesting } from "@/server/ai/provider";
import { closeDb } from "@/server/db/client";
import { getPreferences } from "@/server/services/account";
import { analytics } from "@/server/services/analytics";
import { aiAdvice, assistantBrief } from "@/server/services/assistant";
import { createTask } from "@/server/services/tasks";
import { saveManualSession } from "@/server/services/timer";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => setAiProviderForTesting(null));
afterAll(closeDb);

const now = new Date("2026-11-02T08:00:00Z"); // Monday

describe("assistant", () => {
  it("suggests the overdue, high priority task first and explains why", async () => {
    const u = await makeUser();
    const prefs = (await getPreferences(u.id))!;
    await createTask(u.id, prefs, TaskSchema.parse({ title: "Later", priority: "critical", dueAt: "2026-11-20T17:00" }));
    await createTask(u.id, prefs, TaskSchema.parse({ title: "Overdue report", priority: "high", dueAt: "2026-10-30T17:00" }));
    const b = await assistantBrief(u.id, prefs, now);
    expect(b.next?.title).toBe("Overdue report");
    expect(b.next?.reasons).toContain("it is overdue");
    expect(b.risks.some((r) => r.text.includes("overdue"))).toBe(true);
  });

  it("explains AI is unavailable without a key", async () => {
    const u = await makeUser();
    const prefs = (await getPreferences(u.id))!;
    expect(await aiAdvice(u.id, prefs, now)).toHaveProperty("error");
  });

  it("drops AI moves that touch unknown or critical tasks or leave the horizon", async () => {
    const u = await makeUser();
    const prefs = (await getPreferences(u.id))!;
    const crit = await createTask(u.id, prefs, TaskSchema.parse({ title: "Critical", priority: "critical", scheduledStart: "2026-11-02T09:00", durationMinutes: "60" }));
    const low = await createTask(u.id, prefs, TaskSchema.parse({ title: "Low", priority: "low", scheduledStart: "2026-11-02T11:00", durationMinutes: "60" }));
    setAiProviderForTesting({
      name: "fake",
      async generate(req) {
        return req.schema.parse({
          overview: "Busy Monday.",
          nextTaskId: crit.id,
          nextTaskReason: "Critical first",
          risks: ["Monday is full"],
          moves: [
            { taskId: low.id, toDate: "2026-11-04", reason: "Wednesday has room" },
            { taskId: crit.id, toDate: "2026-11-05", reason: "should be dropped" },
            { taskId: "00000000-0000-0000-0000-000000000000", toDate: "2026-11-05", reason: "unknown" },
            { taskId: low.id, toDate: "2027-01-01", reason: "duplicate and far away" },
          ],
        });
      },
    });
    const out = await aiAdvice(u.id, prefs, now);
    if ("error" in out) throw new Error(out.error);
    expect(out.next?.title).toBe("Critical");
    expect(out.moves.map((m) => [m.title, m.toDate])).toEqual([["Low", "2026-11-04"]]);
  });
});

describe("analytics", () => {
  it("aggregates focus by day and hour, and estimate accuracy", async () => {
    const u = await makeUser();
    const prefs = (await getPreferences(u.id))!;
    const t = await createTask(u.id, prefs, TaskSchema.parse({ title: "Essay", scheduledStart: "2026-11-02T09:00", durationMinutes: "60", estimatedMinutes: "60" }));
    await saveManualSession(u.id, { taskId: t.id, startedAt: new Date("2026-11-02T09:30:00Z"), endedAt: new Date("2026-11-02T10:30:00Z"), kind: "focus", note: "" });
    const a = await analytics(u.id, prefs, "2026-11-01", "2026-11-03", undefined, new Date("2026-11-04T00:00:00Z"));
    expect(a.perDay.map((d) => d.focus)).toEqual([0, 60, 0]);
    expect(a.perDay[1]!.planned).toBe(60);
    expect(a.byHour[9]!.focus).toBe(30);
    expect(a.byHour[10]!.focus).toBe(30);
    expect(a.totalFocus).toBe(60);
    expect(a.categories).toEqual([{ key: "unlinked", minutes: 60 }]);
  });
});
