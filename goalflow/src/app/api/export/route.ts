import { NextResponse } from "next/server";
import { apiAuth } from "@/server/auth/api";
import { exportUserData } from "@/server/services/account";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await apiAuth();
  if (auth instanceof NextResponse) return auth;
  const data = await exportUserData(auth.user.id);
  const date = new Date().toISOString().slice(0, 10);
  return new NextResponse(JSON.stringify(data, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="goalflow-export-${date}.json"`,
      "Cache-Control": "private, no-store",
    },
  });
}
