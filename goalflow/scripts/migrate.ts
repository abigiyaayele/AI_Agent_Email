import { migrate } from "drizzle-orm/node-postgres/migrator";
import { closeDb, db } from "../src/server/db/client";

async function main() {
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is not set. Copy .env.example to .env and fill it in.");
    process.exit(1);
  }
  console.log("Applying migrations...");
  await migrate(db(), { migrationsFolder: "./drizzle" });
  console.log("Database is up to date.");
  await closeDb();
}

main().catch(async (err) => {
  console.error(err);
  await closeDb();
  process.exit(1);
});
