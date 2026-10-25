import { z } from "zod";
import { NOTE_KINDS } from "@/lib/constants";
import { optionalUuid, trimmed } from "./common";

/** "Focus, deep work,  #spanish" → ["focus", "deep work", "spanish"] (deduped, lower case). */
export function parseTags(raw: string): string[] {
  const seen = new Set<string>();
  for (const part of raw.split(",")) {
    const t = part.trim().replace(/^#/, "").replace(/\s+/g, " ").toLowerCase().slice(0, 40);
    if (t) seen.add(t);
  }
  return [...seen].slice(0, 20);
}

export const NoteSaveSchema = z.object({
  title: trimmed(300).default(""),
  body: z.string().max(100_000, "Notes are limited to 100,000 characters").default(""),
  tags: z.string().max(1000).default("").transform(parseTags),
  goalId: optionalUuid,
  taskId: optionalUuid,
  /** The version the editor started from, for detecting edits made elsewhere. */
  baseUpdatedAt: z.string().datetime().optional(),
  force: z.boolean().optional(),
});
export type NoteSaveInput = z.infer<typeof NoteSaveSchema>;

export const NoteCreateSchema = z.object({
  kind: z.enum(NOTE_KINDS).default("quick"),
  title: trimmed(300).default(""),
  body: z.string().max(100_000).default(""),
  goalId: optionalUuid,
  taskId: optionalUuid,
  workSessionId: optionalUuid,
  reviewReportId: optionalUuid,
});
export type NoteCreateInput = z.infer<typeof NoteCreateSchema>;
