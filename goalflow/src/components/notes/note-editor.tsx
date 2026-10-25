"use client";

import { useRouter } from "next/navigation";
import { useCallback, useEffect, useRef, useState } from "react";
import { Star, Trash2 } from "lucide-react";
import { Button, Field, Input, Select, Textarea, cn } from "@/components/ui";
import { ConfirmButton } from "@/components/ui/dialog";
import { deleteNoteAction, favoriteNoteAction, saveNoteAction } from "@/server/actions/notes";

type Draft = { title: string; body: string; tags: string; goalId: string; taskId: string };
type Status = { kind: "saved"; at: Date } | { kind: "dirty" } | { kind: "saving" } | { kind: "error"; message: string } | { kind: "offline" };

const AUTOSAVE_MS = 1200;
const draftKey = (id: string) => `gf-note-draft:${id}`;

function readDraft(id: string): (Draft & { savedAt: string }) | null {
  try {
    const raw = localStorage.getItem(draftKey(id));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}
function writeDraft(id: string, d: Draft | null) {
  try {
    if (d) localStorage.setItem(draftKey(id), JSON.stringify({ ...d, savedAt: new Date().toISOString() }));
    else localStorage.removeItem(draftKey(id));
  } catch {
    // Storage may be unavailable (private mode); autosave to the server still works.
  }
}

/**
 * Note editor with autosave. Every keystroke is kept in local storage first, so a crash, a lost
 * connection or a closed tab never loses text; the server copy is saved after a short pause.
 * Edits made elsewhere are detected and the user chooses which version to keep.
 */
export function NoteEditor({
  id,
  initial,
  updatedAt,
  favorite,
  goals,
  tasks,
  journal,
}: {
  id: string;
  initial: Draft;
  updatedAt: string;
  favorite: boolean;
  goals: { id: string; title: string }[];
  tasks: { id: string; title: string }[];
  journal?: boolean;
}) {
  const router = useRouter();
  const [draft, setDraft] = useState<Draft>(initial);
  const [status, setStatus] = useState<Status>({ kind: "saved", at: new Date(updatedAt) });
  const [recover, setRecover] = useState<(Draft & { savedAt: string }) | null>(null);
  const [conflict, setConflict] = useState<{ title: string; body: string; updatedAt: string } | null>(null);
  const [fav, setFav] = useState(favorite);
  const base = useRef(updatedAt);
  const saved = useRef(JSON.stringify(initial));
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const inFlight = useRef(false);

  useEffect(() => {
    const local = readDraft(id);
    if (local && JSON.stringify({ title: local.title, body: local.body, tags: local.tags, goalId: local.goalId, taskId: local.taskId }) !== saved.current) {
      setRecover(local);
    } else if (local) {
      writeDraft(id, null);
    }
  }, [id]);

  const save = useCallback(
    async (d: Draft, force = false) => {
      if (inFlight.current) return;
      if (!navigator.onLine) {
        setStatus({ kind: "offline" });
        return;
      }
      inFlight.current = true;
      setStatus({ kind: "saving" });
      try {
        const res = await saveNoteAction(id, { ...d, baseUpdatedAt: base.current, force });
        if (res.ok) {
          base.current = res.updatedAt;
          saved.current = JSON.stringify(d);
          writeDraft(id, null);
          setConflict(null);
          setStatus({ kind: "saved", at: new Date(res.updatedAt) });
        } else if (res.conflict) {
          setConflict(res.conflict);
          setStatus({ kind: "error", message: "Changed elsewhere — choose a version below." });
        } else {
          setStatus({ kind: "error", message: res.error });
        }
      } catch {
        setStatus({ kind: "error", message: "Could not reach the server. Your text is kept on this device." });
      } finally {
        inFlight.current = false;
      }
    },
    [id],
  );

  function update(patch: Partial<Draft>) {
    const next = { ...draft, ...patch };
    setDraft(next);
    writeDraft(id, next);
    setStatus({ kind: "dirty" });
    if (timer.current) clearTimeout(timer.current);
    if (!conflict) timer.current = setTimeout(() => save(next), AUTOSAVE_MS);
  }

  // Retry when the connection comes back; warn before leaving with unsaved text.
  useEffect(() => {
    const online = () => {
      if (JSON.stringify(draft) !== saved.current) save(draft);
    };
    const leave = (e: BeforeUnloadEvent) => {
      if (JSON.stringify(draft) !== saved.current) e.preventDefault();
    };
    window.addEventListener("online", online);
    window.addEventListener("beforeunload", leave);
    return () => {
      window.removeEventListener("online", online);
      window.removeEventListener("beforeunload", leave);
    };
  }, [draft, save]);

  const statusText =
    status.kind === "saved"
      ? `Saved ${status.at.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}`
      : status.kind === "saving"
        ? "Saving…"
        : status.kind === "dirty"
          ? "Unsaved changes"
          : status.kind === "offline"
            ? "Offline — kept on this device, will save when you reconnect"
            : status.message;

  return (
    <div className="space-y-4">
      {recover ? (
        <div role="alert" className="rounded-lg border border-warn/50 bg-warn-soft/50 p-3 text-sm">
          <p className="font-medium">An unsaved draft from {new Date(recover.savedAt).toLocaleString()} was found on this device.</p>
          <div className="mt-2 flex gap-2">
            <Button
              size="sm"
              variant="primary"
              onClick={() => {
                const { savedAt: _s, ...d } = recover;
                setRecover(null);
                update(d);
              }}
            >
              Restore draft
            </Button>
            <Button
              size="sm"
              onClick={() => {
                writeDraft(id, null);
                setRecover(null);
              }}
            >
              Discard it
            </Button>
          </div>
        </div>
      ) : null}
      {conflict ? (
        <div role="alert" className="rounded-lg border border-danger/50 bg-danger-soft/40 p-3 text-sm">
          <p className="font-medium text-danger">This note was edited somewhere else at {new Date(conflict.updatedAt).toLocaleTimeString()}.</p>
          <details className="mt-1">
            <summary className="cursor-pointer text-muted">Show the other version</summary>
            <pre className="mt-2 max-h-48 overflow-auto rounded bg-surface-2 p-2 text-xs whitespace-pre-wrap">{conflict.body || "(empty)"}</pre>
          </details>
          <div className="mt-2 flex flex-wrap gap-2">
            <Button size="sm" variant="primary" onClick={() => save(draft, true)}>
              Keep mine
            </Button>
            <Button
              size="sm"
              onClick={() => {
                const d = { ...draft, title: conflict.title, body: conflict.body };
                base.current = conflict.updatedAt;
                saved.current = JSON.stringify(d);
                setDraft(d);
                writeDraft(id, null);
                setConflict(null);
                setStatus({ kind: "saved", at: new Date(conflict.updatedAt) });
              }}
            >
              Use the other version
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Input
          value={draft.title}
          onChange={(e) => update({ title: e.target.value })}
          placeholder={journal ? "Journal" : "Untitled note"}
          aria-label="Title"
          className="h-11 flex-1 text-lg font-semibold"
        />
        <Button
          variant="ghost"
          aria-pressed={fav}
          aria-label={fav ? "Remove from favorites" : "Add to favorites"}
          onClick={async () => {
            setFav(!fav);
            await favoriteNoteAction(id, !fav);
          }}
        >
          <Star size={18} className={cn(fav && "fill-warn text-warn")} />
        </Button>
      </div>
      <Textarea
        value={draft.body}
        onChange={(e) => update({ body: e.target.value })}
        rows={16}
        placeholder={journal ? "How did today go? What went well, what was hard, what will you do differently tomorrow?" : "Write anything…"}
        aria-label="Note text"
        className="min-h-72 font-[inherit] leading-relaxed"
      />
      <p role="status" aria-live="polite" className={cn("text-xs", status.kind === "error" ? "text-danger" : status.kind === "saved" ? "text-ok" : "text-muted")}>
        {statusText}
        {status.kind === "dirty" || status.kind === "error" || status.kind === "offline" ? (
          <button type="button" className="ml-2 underline" onClick={() => save(draft)}>
            Save now
          </button>
        ) : null}
      </p>
      <div className="grid gap-3 sm:grid-cols-3">
        <Field label="Tags" htmlFor="note-tags" hint="Comma separated">
          <Input id="note-tags" value={draft.tags} onChange={(e) => update({ tags: e.target.value })} placeholder="spanish, ideas" />
        </Field>
        <Field label="Goal" htmlFor="note-goal">
          <Select id="note-goal" value={draft.goalId} onChange={(e) => update({ goalId: e.target.value })}>
            <option value="">None</option>
            {goals.map((g) => (
              <option key={g.id} value={g.id}>
                {g.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Task" htmlFor="note-task">
          <Select id="note-task" value={draft.taskId} onChange={(e) => update({ taskId: e.target.value })}>
            <option value="">None</option>
            {tasks.map((t) => (
              <option key={t.id} value={t.id}>
                {t.title}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <div className="flex justify-end">
        <ConfirmButton
          title="Delete this note?"
          description="The note is removed permanently."
          onConfirm={async () => {
            writeDraft(id, null);
            await deleteNoteAction(id);
            router.push("/notes");
          }}
        >
          <Trash2 size={14} /> Delete note
        </ConfirmButton>
      </div>
    </div>
  );
}
