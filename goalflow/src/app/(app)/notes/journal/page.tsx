import { redirect } from "next/navigation";
import { todayIn } from "@/lib/domain/periods";
import { requireAuth } from "@/server/auth/session";
import { journalFor } from "@/server/services/notes";

/** Opens (creating on first visit) the journal entry for a day. */
export default async function JournalPage({ searchParams }: { searchParams: Promise<{ date?: string }> }) {
  const { user, prefs } = await requireAuth();
  const sp = await searchParams;
  const date = sp.date && /^\d{4}-\d{2}-\d{2}$/.test(sp.date) ? sp.date : todayIn(prefs.timezone);
  const n = await journalFor(user.id, date);
  redirect(`/notes/${n.id}`);
}
