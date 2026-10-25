import Link from "next/link";
import { BookOpen, Plus, Star } from "lucide-react";
import { Badge, Card, EmptyState, Input, LinkButton, PageHeader, Select, buttonClass, cn } from "@/components/ui";
import { NOTE_KINDS, type NoteKind } from "@/lib/constants";
import { formatInstant, todayIn } from "@/lib/domain/periods";
import { titleCase } from "@/lib/format";
import { createNoteAction } from "@/server/actions/notes";
import { requireAuth } from "@/server/auth/session";
import { listNotes, listTags, snippet } from "@/server/services/notes";

export const metadata = { title: "Notes & Journal" };

type SP = { q?: string; kind?: string; tag?: string; fav?: string };

export default async function NotesPage({ searchParams }: { searchParams: Promise<SP> }) {
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const sp = await searchParams;
  const kind = (NOTE_KINDS as readonly string[]).includes(sp.kind ?? "") ? (sp.kind as NoteKind) : undefined;
  const q = sp.q?.trim().slice(0, 200) || undefined;
  const [notes, tags] = await Promise.all([
    listNotes(user.id, { q, kind, tag: sp.tag || undefined, favorite: sp.fav === "1" }),
    listTags(user.id),
  ]);
  const link = (patch: Partial<SP>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries({ ...sp, ...patch })) if (v) p.set(k, v);
    return `/notes?${p.toString()}`;
  };

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notes & Journal"
        subtitle={`${notes.length} note${notes.length === 1 ? "" : "s"}${q ? ` matching “${q}”` : ""}`}
        actions={
          <>
            <LinkButton size="sm" href={`/notes/journal?date=${todayIn(tz)}`}>
              <BookOpen size={14} /> Today&apos;s journal
            </LinkButton>
            <form action={createNoteAction}>
              <button type="submit" className={buttonClass("primary", "sm")}>
                <Plus size={14} /> New note
              </button>
            </form>
          </>
        }
      />
      <Card>
        <form className="grid gap-2 sm:grid-cols-[1fr_10rem_auto]" role="search">
          {sp.tag ? <input type="hidden" name="tag" value={sp.tag} /> : null}
          {sp.fav ? <input type="hidden" name="fav" value={sp.fav} /> : null}
          <Input name="q" defaultValue={sp.q} placeholder="Search notes and journal…" aria-label="Search notes" />
          <Select name="kind" defaultValue={sp.kind ?? ""} aria-label="Type">
            <option value="">All types</option>
            {NOTE_KINDS.map((k) => (
              <option key={k} value={k}>
                {titleCase(k)}
              </option>
            ))}
          </Select>
          <button type="submit" className={buttonClass("secondary")}>
            Search
          </button>
        </form>
        <div className="mt-3 flex flex-wrap gap-1.5 text-sm">
          <Link href={link({ fav: sp.fav === "1" ? undefined : "1" })} className={cn("inline-flex items-center gap-1 rounded-lg border px-2 py-0.5", sp.fav === "1" ? "border-warn bg-warn-soft" : "border-border")}>
            <Star size={12} /> Favorites
          </Link>
          {tags.map((t) => (
            <Link key={t.name} href={link({ tag: sp.tag === t.name ? undefined : t.name })} className={cn("rounded-lg border px-2 py-0.5", sp.tag === t.name ? "border-accent bg-accent-soft text-accent" : "border-border")}>
              #{t.name} <span className="text-xs text-muted">{t.count}</span>
            </Link>
          ))}
          {sp.q || sp.kind || sp.tag || sp.fav ? (
            <Link href="/notes" className="px-2 py-0.5 text-muted underline">
              Clear
            </Link>
          ) : null}
        </div>
      </Card>

      {notes.length ? (
        <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map(({ note: n, goalTitle, taskTitle, tags: nt }) => (
            <li key={n.id}>
              <Link href={`/notes/${n.id}`} className="block h-full rounded-xl border border-border bg-surface p-4 hover:border-accent/60">
                <div className="flex items-start justify-between gap-2">
                  <h2 className="line-clamp-2 font-medium">{n.title || (n.kind === "journal" ? `Journal — ${n.journalDate}` : "Untitled note")}</h2>
                  {n.favorite ? <Star size={14} className="shrink-0 fill-warn text-warn" aria-label="Favorite" /> : null}
                </div>
                <p className="mt-1 line-clamp-3 text-sm text-muted">{snippet(n.body, q) || <em>Empty</em>}</p>
                <div className="mt-2 flex flex-wrap items-center gap-1 text-xs">
                  <Badge tone={n.kind === "journal" ? "accent" : "neutral"}>{n.kind}</Badge>
                  {goalTitle ? <Badge tone="info">{goalTitle}</Badge> : null}
                  {taskTitle ? <Badge>{taskTitle}</Badge> : null}
                  {nt.map((t) => (
                    <span key={t} className="text-muted">
                      #{t}
                    </span>
                  ))}
                  <span className="ml-auto text-muted">{formatInstant(n.updatedAt, tz, "d LLL HH:mm")}</span>
                </div>
              </Link>
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState title={q || sp.tag || sp.kind || sp.fav ? "No notes match" : "No notes yet"}>
          {q ? "Try fewer or shorter words; search matches word beginnings." : "Capture ideas, reflections and a daily journal. Notes save automatically as you type."}
        </EmptyState>
      )}
    </div>
  );
}
