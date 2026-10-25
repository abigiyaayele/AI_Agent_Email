"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { z } from "zod";
import { NOTE_KINDS } from "@/lib/constants";
import { NoteCreateSchema, NoteSaveSchema } from "@/lib/validation/note";
import { requireAuth } from "@/server/auth/session";
import { createNote, deleteNote, NoteConflictError, NoteError, saveNote, setFavorite } from "@/server/services/notes";

const id = z.string().uuid();

export type SaveNoteResult =
  | { ok: true; updatedAt: string }
  | { ok: false; error: string; conflict?: { title: string; body: string; updatedAt: string } };

/** Create a note (optionally linked) and open it. Used by "New note" buttons. */
export async function createNoteAction(fd: FormData) {
  const { user } = await requireAuth();
  const parsed = NoteCreateSchema.parse({
    kind: z.enum(NOTE_KINDS).catch("quick").parse(fd.get("kind") ?? "quick"),
    title: fd.get("title") ?? "",
    goalId: fd.get("goalId"),
    taskId: fd.get("taskId"),
    workSessionId: fd.get("workSessionId"),
    reviewReportId: fd.get("reviewReportId"),
  });
  const n = await createNote(user.id, parsed);
  redirect(`/notes/${n.id}`);
}

export async function saveNoteAction(noteId: string, input: unknown): Promise<SaveNoteResult> {
  const { user } = await requireAuth();
  const parsed = NoteSaveSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Invalid note" };
  try {
    const n = await saveNote(user.id, id.parse(noteId), parsed.data);
    revalidatePath("/notes");
    return { ok: true, updatedAt: n.updatedAt.toISOString() };
  } catch (err) {
    if (err instanceof NoteConflictError) {
      return { ok: false, error: err.message, conflict: { title: err.current.title, body: err.current.body, updatedAt: err.current.updatedAt.toISOString() } };
    }
    if (err instanceof NoteError) return { ok: false, error: err.message };
    throw err;
  }
}

export async function favoriteNoteAction(noteId: string, favorite: boolean) {
  const { user } = await requireAuth();
  await setFavorite(user.id, id.parse(noteId), favorite);
  revalidatePath("/notes", "layout");
}

export async function deleteNoteAction(noteId: string) {
  const { user } = await requireAuth();
  await deleteNote(user.id, id.parse(noteId));
  revalidatePath("/notes", "layout");
}
