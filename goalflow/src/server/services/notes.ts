import { and, desc, eq, inArray, sql, type SQL } from "drizzle-orm";
import type { NoteKind } from "@/lib/constants";
import type { NoteCreateInput, NoteSaveInput } from "@/lib/validation/note";
import { db, type Executor } from "@/server/db/client";
import * as s from "@/server/db/schema";

export class NoteError extends Error {}
/** The note changed elsewhere (another tab or device) after the editor loaded it. */
export class NoteConflictError extends Error {
  constructor(public current: { title: string; body: string; updatedAt: Date }) {
    super("This note was changed somewhere else.");
  }
}

/** Turn free text into a prefix tsquery: "spa verb" → 'spa':* & 'verb':*. */
export function toPrefixQuery(q: string): string | null {
  const words = q
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter(Boolean)
    .slice(0, 8);
  return words.length ? words.map((w) => `'${w}':*`).join(" & ") : null;
}

async function assertOwned(ex: Executor, userId: string, links: { goalId?: string | null; taskId?: string | null; workSessionId?: string | null; reviewReportId?: string | null }) {
  const checks: [string | null | undefined, typeof s.goals | typeof s.tasks | typeof s.workSessions | typeof s.reviewReports][] = [
    [links.goalId, s.goals],
    [links.taskId, s.tasks],
    [links.workSessionId, s.workSessions],
    [links.reviewReportId, s.reviewReports],
  ];
  for (const [id, table] of checks) {
    if (!id) continue;
    const [row] = await ex.select({ id: table.id }).from(table).where(and(eq(table.id, id), eq(table.userId, userId)));
    if (!row) throw new NoteError("Linked item not found.");
  }
}

async function setTags(ex: Executor, userId: string, noteId: string, names: string[]) {
  await ex.delete(s.noteTags).where(eq(s.noteTags.noteId, noteId));
  if (!names.length) return;
  await ex
    .insert(s.tags)
    .values(names.map((name) => ({ userId, name })))
    .onConflictDoNothing();
  const rows = await ex.select({ id: s.tags.id }).from(s.tags).where(and(eq(s.tags.userId, userId), inArray(s.tags.name, names)));
  await ex.insert(s.noteTags).values(rows.map((r) => ({ noteId, tagId: r.id })));
}

export async function createNote(userId: string, input: NoteCreateInput) {
  return db().transaction(async (tx) => {
    await assertOwned(tx, userId, input);
    const [n] = await tx.insert(s.notes).values({ userId, ...input }).returning();
    return n!;
  });
}

/** The journal entry for a local date, created on first open (unique per user and day). */
export async function journalFor(userId: string, date: string) {
  await db().insert(s.notes).values({ userId, kind: "journal", journalDate: date, title: `Journal — ${date}` }).onConflictDoNothing();
  const [n] = await db()
    .select()
    .from(s.notes)
    .where(and(eq(s.notes.userId, userId), eq(s.notes.kind, "journal"), eq(s.notes.journalDate, date)));
  return n!;
}

/**
 * Autosave. If the editor's base version is older than the stored one and the content differs,
 * refuse with the current content so the user can choose; nothing is overwritten silently.
 */
export async function saveNote(userId: string, id: string, input: NoteSaveInput) {
  return db().transaction(async (tx) => {
    const [n] = await tx.select().from(s.notes).where(and(eq(s.notes.id, id), eq(s.notes.userId, userId))).for("update");
    if (!n) throw new NoteError("Note not found.");
    if (!input.force && input.baseUpdatedAt && n.updatedAt.getTime() > new Date(input.baseUpdatedAt).getTime() + 1) {
      if (n.title !== input.title || n.body !== input.body) throw new NoteConflictError({ title: n.title, body: n.body, updatedAt: n.updatedAt });
    }
    await assertOwned(tx, userId, input);
    const [u] = await tx
      .update(s.notes)
      .set({ title: input.title, body: input.body, goalId: input.goalId, taskId: input.taskId, updatedAt: new Date() })
      .where(eq(s.notes.id, id))
      .returning();
    await setTags(tx, userId, id, input.tags);
    return u!;
  });
}

export async function setFavorite(userId: string, id: string, favorite: boolean) {
  await db().update(s.notes).set({ favorite }).where(and(eq(s.notes.id, id), eq(s.notes.userId, userId)));
}

export async function deleteNote(userId: string, id: string) {
  await db().delete(s.notes).where(and(eq(s.notes.id, id), eq(s.notes.userId, userId)));
}

export type NoteFilters = { q?: string; kind?: NoteKind; tag?: string; favorite?: boolean; goalId?: string; taskId?: string; limit?: number };

export async function listNotes(userId: string, f: NoteFilters = {}) {
  const where: SQL[] = [eq(s.notes.userId, userId)];
  const tsq = f.q ? toPrefixQuery(f.q) : null;
  if (tsq) where.push(sql`${s.notes.search} @@ to_tsquery('simple', ${tsq})`);
  if (f.kind) where.push(eq(s.notes.kind, f.kind));
  if (f.favorite) where.push(eq(s.notes.favorite, true));
  if (f.goalId) where.push(eq(s.notes.goalId, f.goalId));
  if (f.taskId) where.push(eq(s.notes.taskId, f.taskId));
  if (f.tag)
    where.push(
      sql`exists (select 1 from ${s.noteTags} nt join ${s.tags} tg on tg.id = nt.tag_id where nt.note_id = ${s.notes.id} and tg.name = ${f.tag})`,
    );
  const rows = await db()
    .select({ note: s.notes, goalTitle: s.goals.title, taskTitle: s.tasks.title })
    .from(s.notes)
    .leftJoin(s.goals, eq(s.goals.id, s.notes.goalId))
    .leftJoin(s.tasks, eq(s.tasks.id, s.notes.taskId))
    .where(and(...where))
    .orderBy(
      ...(tsq ? [desc(sql`ts_rank(${s.notes.search}, to_tsquery('simple', ${tsq}))`)] : []),
      desc(s.notes.favorite),
      desc(s.notes.updatedAt),
    )
    .limit(f.limit ?? 100);
  const tagMap = await tagsFor(rows.map((r) => r.note.id));
  return rows.map((r) => ({ ...r, tags: tagMap.get(r.note.id) ?? [] }));
}

export async function tagsFor(noteIds: string[]) {
  const map = new Map<string, string[]>();
  if (!noteIds.length) return map;
  const rows = await db()
    .select({ noteId: s.noteTags.noteId, name: s.tags.name })
    .from(s.noteTags)
    .innerJoin(s.tags, eq(s.tags.id, s.noteTags.tagId))
    .where(inArray(s.noteTags.noteId, noteIds));
  for (const r of rows) map.set(r.noteId, [...(map.get(r.noteId) ?? []), r.name]);
  return map;
}

export async function listTags(userId: string) {
  return db()
    .select({ name: s.tags.name, count: sql<number>`count(${s.noteTags.noteId})::int` })
    .from(s.tags)
    .leftJoin(s.noteTags, eq(s.noteTags.tagId, s.tags.id))
    .where(eq(s.tags.userId, userId))
    .groupBy(s.tags.name)
    .having(sql`count(${s.noteTags.noteId}) > 0`)
    .orderBy(desc(sql`count(${s.noteTags.noteId})`));
}

export async function getNote(userId: string, id: string) {
  const [row] = await db()
    .select({ note: s.notes, goalTitle: s.goals.title, taskTitle: s.tasks.title })
    .from(s.notes)
    .leftJoin(s.goals, eq(s.goals.id, s.notes.goalId))
    .leftJoin(s.tasks, eq(s.tasks.id, s.notes.taskId))
    .where(and(eq(s.notes.id, id), eq(s.notes.userId, userId)));
  if (!row) return null;
  const tags = (await tagsFor([id])).get(id) ?? [];
  return { ...row, tags };
}

/** Short plain-text excerpt around the first search hit (or the start). */
export function snippet(body: string, q?: string, len = 180): string {
  const text = body.replace(/\s+/g, " ").trim();
  if (!q) return text.length > len ? text.slice(0, len) + "…" : text;
  const word = q.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
  const i = word ? text.toLowerCase().indexOf(word) : -1;
  const start = Math.max(0, i - 60);
  const out = text.slice(start, start + len);
  return (start > 0 ? "…" : "") + out + (start + len < text.length ? "…" : "");
}
