import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { NoteSaveSchema, parseTags } from "@/lib/validation/note";
import { closeDb } from "@/server/db/client";
import { createNote, getNote, journalFor, listNotes, listTags, NoteConflictError, NoteError, saveNote, toPrefixQuery } from "@/server/services/notes";
import { createGoal } from "@/server/services/goals";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

const save = (over: Record<string, unknown>) => NoteSaveSchema.parse({ title: "", body: "", tags: "", ...over });

describe("notes", () => {
  it("parses tags and builds safe prefix queries", () => {
    expect(parseTags(" Focus, #Spanish,focus , deep   work,,")).toEqual(["focus", "spanish", "deep work"]);
    expect(toPrefixQuery("Spa verb's & | !")).toBe("'spa':* & 'verb':* & 's':*");
    expect(toPrefixQuery("  ")).toBeNull();
  });

  it("searches by word prefix, filters by tag and favorites", async () => {
    const u = await makeUser();
    const a = await createNote(u.id, { kind: "quick", title: "Spanish verbs", body: "Irregular preterite forms", goalId: null, taskId: null, workSessionId: null, reviewReportId: null });
    const b = await createNote(u.id, { kind: "quick", title: "Grocery", body: "eggs, milk", goalId: null, taskId: null, workSessionId: null, reviewReportId: null });
    await saveNote(u.id, a.id, save({ title: "Spanish verbs", body: "Irregular preterite forms", tags: "spanish, grammar" }));
    await saveNote(u.id, b.id, save({ title: "Grocery", body: "eggs, milk", tags: "home" }));
    expect((await listNotes(u.id, { q: "preter" })).map((n) => n.note.id)).toEqual([a.id]);
    expect((await listNotes(u.id, { q: "SPAN irreg" })).map((n) => n.note.id)).toEqual([a.id]);
    expect((await listNotes(u.id, { tag: "home" })).map((n) => n.note.id)).toEqual([b.id]);
    expect((await listTags(u.id)).map((t) => t.name).sort()).toEqual(["grammar", "home", "spanish"]);
    const got = await getNote(u.id, a.id);
    expect(got!.tags.sort()).toEqual(["grammar", "spanish"]);
  });

  it("keeps one journal entry per day", async () => {
    const u = await makeUser();
    const j1 = await journalFor(u.id, "2026-11-02");
    const j2 = await journalFor(u.id, "2026-11-02");
    const j3 = await journalFor(u.id, "2026-11-03");
    expect(j1.id).toBe(j2.id);
    expect(j3.id).not.toBe(j1.id);
  });

  it("refuses to overwrite edits made elsewhere unless forced", async () => {
    const u = await makeUser();
    const n = await createNote(u.id, { kind: "quick", title: "", body: "", goalId: null, taskId: null, workSessionId: null, reviewReportId: null });
    const base = n.updatedAt.toISOString();
    await new Promise((r) => setTimeout(r, 5));
    await saveNote(u.id, n.id, save({ body: "from phone", baseUpdatedAt: base }));
    await expect(saveNote(u.id, n.id, save({ body: "from laptop", baseUpdatedAt: base }))).rejects.toBeInstanceOf(NoteConflictError);
    const forced = await saveNote(u.id, n.id, save({ body: "from laptop", baseUpdatedAt: base, force: true }));
    expect(forced.body).toBe("from laptop");
  });

  it("isolates users and refuses links to another user's items", async () => {
    const a = await makeUser();
    const b = await makeUser();
    const n = await createNote(a.id, { kind: "quick", title: "secret", body: "", goalId: null, taskId: null, workSessionId: null, reviewReportId: null });
    expect(await getNote(b.id, n.id)).toBeNull();
    expect(await listNotes(b.id, { q: "secret" })).toHaveLength(0);
    await expect(saveNote(b.id, n.id, save({ body: "x" }))).rejects.toBeInstanceOf(NoteError);
    const g = await createGoal(a.id, {
      title: "A's goal", description: "", level: "year", parentId: null, category: "personal", startDate: "2026-01-01", targetDate: "2026-12-31",
      metricType: "tasks", unit: "", direction: "increase", startValue: 0, targetValue: null, currentValue: 0, priority: "medium", status: "active", estimatedHours: null, weight: 1,
    });
    await expect(createNote(b.id, { kind: "goal", title: "", body: "", goalId: g.id, taskId: null, workSessionId: null, reviewReportId: null })).rejects.toBeInstanceOf(NoteError);
  });
});
