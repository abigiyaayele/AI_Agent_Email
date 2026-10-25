import { afterAll, afterEach, beforeEach, describe, expect, it } from "vitest";
import { and, eq } from "drizzle-orm";
import { TaskSchema } from "@/lib/validation/task";
import { AiUnavailableError, setAiProviderForTesting, type AiProvider } from "@/server/ai/provider";
import { closeDb, db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getPreferences } from "@/server/services/account";
import { generateSummary, periodReview, saveReflection } from "@/server/services/reviews";
import { createTask, setTaskStatus } from "@/server/services/tasks";
import { saveManualSession } from "@/server/services/timer";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterEach(() => setAiProviderForTesting(null));
afterAll(closeDb);

async function seedDay() {
  const u = await makeUser();
  const prefs = (await getPreferences(u.id))!;
  const a = await createTask(u.id, prefs, TaskSchema.parse({ title: "Write chapter", scheduledStart: "2026-11-02T09:00", durationMinutes: "60", estimatedMinutes: "60" }));
  const b = await createTask(u.id, prefs, TaskSchema.parse({ title: "Email advisor", scheduledStart: "2026-11-02T11:00", durationMinutes: "30" }));
  await saveManualSession(u.id, { taskId: a.id, startedAt: new Date("2026-11-02T09:00:00Z"), endedAt: new Date("2026-11-02T10:10:00Z"), kind: "focus", note: "" });
  await setTaskStatus(u.id, prefs, a.id, "done");
  await db().update(s.tasks).set({ completedAt: new Date("2026-11-02T10:10:00Z") }).where(eq(s.tasks.id, a.id));
  return { u, prefs, a, b };
}

describe("period reviews", () => {
  it("computes done, undone and time for a day from stored data", async () => {
    const { u, prefs } = await seedDay();
    const r = await periodReview(u.id, prefs, "day", "2026-11-02", new Date("2026-11-02T20:00:00Z"));
    expect(r.metrics.planned).toBe(2);
    expect(r.metrics.completedPlanned).toBe(1);
    expect(r.metrics.completionRate).toBe(50);
    expect(r.metrics.focusMinutes).toBe(70);
    expect(r.metrics.done.map((t) => t.title)).toEqual(["Write chapter"]);
    expect(r.metrics.unfinished.map((t) => t.title)).toEqual(["Email advisor"]);
  });

  it("uses the built-in summary without an AI key", async () => {
    const { u, prefs } = await seedDay();
    const out = await generateSummary(u.id, prefs, "day", "2026-11-02");
    expect(out.source).toBe("rules");
    expect(out.text).toContain("Write chapter");
    expect(out.text).toContain("Email advisor");
    const [row] = await db().select().from(s.reviewReports).where(and(eq(s.reviewReports.userId, u.id), eq(s.reviewReports.periodType, "day")));
    expect(row!.summarySource).toBe("rules");
  });

  it("uses validated AI output when configured and falls back when the AI fails", async () => {
    const { u, prefs } = await seedDay();
    let seenPrompt = "";
    const fake: AiProvider = {
      name: "fake",
      async generate(req) {
        seenPrompt = req.prompt;
        return req.schema.parse({ summary: "A focused morning.", done: ["Write chapter"], notDone: ["Email advisor"], timeInsight: "70 minutes on a 60 minute task.", suggestions: ["Email advisor first thing"] });
      },
    };
    setAiProviderForTesting(fake);
    const ai = await generateSummary(u.id, prefs, "day", "2026-11-02");
    expect(ai.source).toBe("ai");
    expect(ai.text).toContain("A focused morning.");
    expect(seenPrompt).toContain("Email advisor");
    expect(seenPrompt).not.toContain(u.email);

    setAiProviderForTesting({ name: "broken", generate: async () => { throw new AiUnavailableError("down"); } });
    const fallback = await generateSummary(u.id, prefs, "day", "2026-11-02");
    expect(fallback.source).toBe("rules");
    expect(fallback.warning).toBe("down");
  });

  it("saves one reflection per period and updates it", async () => {
    const { u, prefs } = await seedDay();
    await saveReflection(u.id, prefs, "week", "2026-11-04", { wins: "Shipped", obstacles: "", lessons: "", decisions: "", nextPriorities: "" });
    await saveReflection(u.id, prefs, "week", "2026-11-05", { wins: "Shipped more", obstacles: "", lessons: "", decisions: "Cut scope", nextPriorities: "" });
    const rows = await db().select().from(s.reviewReports).where(eq(s.reviewReports.userId, u.id));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ periodStart: "2026-11-02", periodEnd: "2026-11-08", wins: "Shipped more", decisions: "Cut scope" });
    expect((rows[0]!.metrics as { completed: number }).completed).toBe(1);
  });
});
