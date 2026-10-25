import Link from "next/link";
import { notFound } from "next/navigation";
import { desc, eq } from "drizzle-orm";
import { Card, LinkButton, PageHeader } from "@/components/ui";
import { NoteEditor } from "@/components/notes/note-editor";
import { addDays, formatDate, formatInstant } from "@/lib/domain/periods";
import { requireAuth } from "@/server/auth/session";
import { db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { getNote } from "@/server/services/notes";

export const metadata = { title: "Note" };

export default async function NotePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^[0-9a-f-]{36}$/.test(id)) notFound();
  const { user, prefs } = await requireAuth();
  const tz = prefs.timezone;
  const d = await getNote(user.id, id);
  if (!d) notFound();
  const n = d.note;
  const [goals, tasks] = await Promise.all([
    db().select({ id: s.goals.id, title: s.goals.title }).from(s.goals).where(eq(s.goals.userId, user.id)).orderBy(desc(s.goals.updatedAt)).limit(200),
    db().select({ id: s.tasks.id, title: s.tasks.title }).from(s.tasks).where(eq(s.tasks.userId, user.id)).orderBy(desc(s.tasks.updatedAt)).limit(200),
  ]);
  const journal = n.kind === "journal" && n.journalDate;

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <PageHeader
        title={journal ? `Journal · ${formatDate(n.journalDate, "cccc d LLLL yyyy")}` : "Note"}
        subtitle={`Created ${formatInstant(n.createdAt, tz, "d LLL yyyy HH:mm")}`}
        actions={
          <>
            {journal ? (
              <>
                <LinkButton size="sm" href={`/notes/journal?date=${addDays(n.journalDate!, -1)}`}>
                  ← Previous day
                </LinkButton>
                <LinkButton size="sm" href={`/notes/journal?date=${addDays(n.journalDate!, 1)}`}>
                  Next day →
                </LinkButton>
              </>
            ) : null}
            <LinkButton size="sm" href="/notes">
              All notes
            </LinkButton>
          </>
        }
      />
      <Card>
        <NoteEditor
          id={n.id}
          journal={Boolean(journal)}
          initial={{ title: n.title, body: n.body, tags: d.tags.join(", "), goalId: n.goalId ?? "", taskId: n.taskId ?? "" }}
          updatedAt={n.updatedAt.toISOString()}
          favorite={n.favorite}
          goals={goals}
          tasks={tasks}
        />
      </Card>
      {d.goalTitle || d.taskTitle ? (
        <p className="text-sm text-muted">
          Linked to{" "}
          {d.goalTitle ? (
            <Link className="underline" href={`/goals/${n.goalId}`}>
              {d.goalTitle}
            </Link>
          ) : null}
          {d.goalTitle && d.taskTitle ? " and " : null}
          {d.taskTitle ? (
            <Link className="underline" href={`/tasks/${n.taskId}`}>
              {d.taskTitle}
            </Link>
          ) : null}
          .
        </p>
      ) : null}
    </div>
  );
}
