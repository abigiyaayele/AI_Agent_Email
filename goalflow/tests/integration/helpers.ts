import { sql } from "drizzle-orm";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db } from "@/server/db/client";
import { registerUser } from "@/server/services/account";

let migrated = false;

export async function resetDb() {
  if (!migrated) {
    await migrate(db(), { migrationsFolder: "./drizzle" });
    migrated = true;
  }
  await db().execute(sql`truncate table users, rate_limits restart identity cascade`);
}

let n = 0;
export async function makeUser(tz = "UTC") {
  n++;
  return registerUser({ name: `User ${n}`, email: `user${n}-${Date.now()}@example.com`, password: "correct-horse-battery", timezone: tz });
}
