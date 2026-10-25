import Link from "next/link";
import { Plus } from "lucide-react";
import { buttonClass } from "@/components/ui";
import { createNoteAction } from "@/server/actions/notes";

/** Notes linked to a goal or task, with a button that creates a new linked note. */
export function LinkedNotes({
  notes,
  link,
  kind,
}: {
  notes: { id: string; title: string; excerpt: string; when: string }[];
  link: { goalId?: string; taskId?: string };
  kind: "goal" | "task";
}) {
  return (
    <div>
      {notes.length ? (
        <ul className="mb-2 divide-y divide-border">
          {notes.map((n) => (
            <li key={n.id} className="py-1.5">
              <Link href={`/notes/${n.id}`} className="block text-sm hover:underline">
                <span className="font-medium">{n.title || "Untitled note"}</span>
                <span className="ml-2 text-xs text-muted">{n.when}</span>
                {n.excerpt ? <span className="block truncate text-xs text-muted">{n.excerpt}</span> : null}
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mb-2 text-sm text-muted">No notes yet.</p>
      )}
      <form action={createNoteAction}>
        <input type="hidden" name="kind" value={kind} />
        {link.goalId ? <input type="hidden" name="goalId" value={link.goalId} /> : null}
        {link.taskId ? <input type="hidden" name="taskId" value={link.taskId} /> : null}
        <button type="submit" className={buttonClass("secondary", "sm")}>
          <Plus size={14} /> Add note
        </button>
      </form>
    </div>
  );
}
