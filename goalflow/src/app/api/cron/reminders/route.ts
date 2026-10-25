import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@/lib/env";
import { processDueReminders } from "@/server/services/reminders";

export const dynamic = "force-dynamic";

function authorized(req: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret) return false;
  const given = Buffer.from(req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? "");
  const expected = Buffer.from(secret);
  return given.length === expected.length && timingSafeEqual(given, expected);
}

/** For an external scheduler (Vercel Cron, GitHub Actions, crontab + curl). Requires CRON_SECRET. */
async function handle(req: NextRequest) {
  if (!env().CRON_SECRET) return NextResponse.json({ error: "CRON_SECRET is not configured" }, { status: 503 });
  if (!authorized(req)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  const created = await processDueReminders({ limit: 500 });
  return NextResponse.json({ ok: true, fired: created.length });
}

export const GET = handle;
export const POST = handle;
