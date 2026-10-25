import { sql } from "drizzle-orm";
import { db } from "@/server/db/client";

/**
 * Fixed-window rate limiter stored in Postgres so it works across server instances.
 * Returns false when the caller has exceeded `limit` hits in the current window.
 */
export async function rateLimit(key: string, limit: number, windowSeconds: number): Promise<boolean> {
  const res = await db().execute<{ count: number }>(sql`
    insert into rate_limits (key, window_start, count) values (${key}, now(), 1)
    on conflict (key) do update set
      count = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then 1 else rate_limits.count + 1 end,
      window_start = case when rate_limits.window_start < now() - make_interval(secs => ${windowSeconds}) then now() else rate_limits.window_start end
    returning count
  `);
  return Number(res.rows[0]?.count ?? 0) <= limit;
}
