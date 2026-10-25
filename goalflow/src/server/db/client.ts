import { drizzle, type NodePgDatabase } from "drizzle-orm/node-postgres";
import { Pool } from "pg";
import { env } from "@/lib/env";
import * as schema from "./schema";

export type DB = NodePgDatabase<typeof schema>;
export type Tx = Parameters<Parameters<DB["transaction"]>[0]>[0];
export type Executor = DB | Tx;

const globalForDb = globalThis as unknown as { __goalflowPool?: Pool; __goalflowDb?: DB };

export function db(): DB {
  if (globalForDb.__goalflowDb) return globalForDb.__goalflowDb;
  const url = env().DATABASE_URL;
  const pool =
    globalForDb.__goalflowPool ??
    new Pool({
      connectionString: url,
      max: Number(process.env.DATABASE_POOL_MAX ?? 10),
      ssl: /sslmode=require|supabase\.(co|com)/.test(url) ? { rejectUnauthorized: false } : undefined,
    });
  globalForDb.__goalflowPool = pool;
  globalForDb.__goalflowDb = drizzle(pool, { schema });
  return globalForDb.__goalflowDb;
}

export async function closeDb() {
  await globalForDb.__goalflowPool?.end();
  globalForDb.__goalflowPool = undefined;
  globalForDb.__goalflowDb = undefined;
}

export { schema };
