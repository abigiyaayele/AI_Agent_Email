import { Client } from "pg";

/** E2E runs register several users; clear the sign-up rate limiter so repeated local runs work. */
export default async function globalSetup() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return;
  const c = new Client({ connectionString: url });
  await c.connect();
  await c.query("delete from rate_limits");
  await c.end();
}
