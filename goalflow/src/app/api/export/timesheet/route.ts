import { NextResponse, type NextRequest } from "next/server";
import { apiAuth } from "@/server/auth/api";
import { eachDate } from "@/lib/domain/periods";
import { buildTimesheet, timesheetCsv } from "@/server/services/timesheet";

export const dynamic = "force-dynamic";

const DATE = /^\d{4}-\d{2}-\d{2}$/;

export async function GET(req: NextRequest) {
  const auth = await apiAuth();
  if (auth instanceof NextResponse) return auth;
  const from = req.nextUrl.searchParams.get("from") ?? "";
  const to = req.nextUrl.searchParams.get("to") ?? "";
  if (!DATE.test(from) || !DATE.test(to) || to < from) return NextResponse.json({ error: "from and to must be dates, from ≤ to" }, { status: 400 });
  const dates = eachDate(from, to);
  if (dates.length > 400) return NextResponse.json({ error: "Range too long (max 400 days)" }, { status: 400 });
  const sheet = await buildTimesheet(auth.user.id, auth.prefs.timezone, dates);
  return new NextResponse(timesheetCsv(sheet.sessions, auth.prefs.timezone), {
    headers: {
      "Content-Type": "text/csv; charset=utf-8",
      "Content-Disposition": `attachment; filename="goalflow-timesheet-${from}_${to}.csv"`,
      "Cache-Control": "private, no-store",
    },
  });
}
