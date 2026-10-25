import { NextResponse, type NextRequest } from "next/server";
import { z } from "zod";
import { apiAuth, sameOrigin } from "@/server/auth/api";
import { processDueReminders, recentUnread, unreadCount } from "@/server/services/reminders";

export const dynamic = "force-dynamic";

/**
 * Called by open GoalFlow tabs about once a minute. Fires this user's due reminders (so in-app
 * reminders work even without a cron job) and returns notifications the tab has not shown yet.
 */
export async function POST(req: NextRequest) {
  if (!sameOrigin(req)) return NextResponse.json({ error: "Bad origin" }, { status: 403 });
  const auth = await apiAuth();
  if (auth instanceof NextResponse) return auth;
  const body = z.object({ since: z.string().datetime().optional() }).safeParse(await req.json().catch(() => ({})));
  const since = body.success && body.data.since ? new Date(body.data.since) : new Date(Date.now() - 5 * 60_000);
  await processDueReminders({ userId: auth.user.id, limit: 50 });
  const [items, unread] = await Promise.all([recentUnread(auth.user.id, since), unreadCount(auth.user.id)]);
  return NextResponse.json(
    {
      now: new Date().toISOString(),
      unread,
      items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, url: n.url, createdAt: n.createdAt.toISOString() })),
    },
    { headers: { "Cache-Control": "no-store" } },
  );
}
