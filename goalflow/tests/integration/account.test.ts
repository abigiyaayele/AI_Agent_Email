import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { closeDb, db } from "@/server/db/client";
import * as s from "@/server/db/schema";
import { AccountError, authenticate, deleteAccount, exportUserData, getPreferences, registerUser } from "@/server/services/account";
import { rateLimit } from "@/server/auth/rate-limit";
import { makeUser, resetDb } from "./helpers";

beforeEach(resetDb);
afterAll(closeDb);

describe("accounts", () => {
  it("registers a user with preferences and the built-in review reminders", async () => {
    const u = await makeUser("Europe/Paris");
    const prefs = await getPreferences(u.id);
    expect(prefs.timezone).toBe("Europe/Paris");
    const reminders = await db().select().from(s.reminders).where(eq(s.reminders.userId, u.id));
    expect(reminders.map((r) => r.kind).sort()).toEqual(
      ["daily_plan", "daily_review", "half_review", "monthly_review", "quarterly_review", "weekly_review", "yearly_review"].sort(),
    );
    expect(reminders.every((r) => r.nextFireAt && r.nextFireAt > new Date())).toBe(true);
  });

  it("rejects duplicate emails case-insensitively and stores only a hash", async () => {
    const u = await registerUser({ name: "A", email: "Same@Example.com", password: "correct-horse-battery", timezone: "UTC" });
    expect(u.passwordHash).not.toContain("correct-horse");
    await expect(registerUser({ name: "B", email: "same@example.com", password: "another-password", timezone: "UTC" })).rejects.toBeInstanceOf(AccountError);
  });

  it("authenticates only with the right password", async () => {
    await registerUser({ name: "A", email: "a@example.com", password: "correct-horse-battery", timezone: "UTC" });
    expect(await authenticate("A@example.com", "correct-horse-battery")).not.toBeNull();
    expect(await authenticate("a@example.com", "wrong")).toBeNull();
    expect(await authenticate("nobody@example.com", "whatever")).toBeNull();
  });

  it("rate limits repeated attempts", async () => {
    for (let i = 0; i < 3; i++) expect(await rateLimit("k", 3, 60)).toBe(true);
    expect(await rateLimit("k", 3, 60)).toBe(false);
  });

  it("exports only the user's own data and deletes everything on account deletion", async () => {
    const a = await makeUser();
    const b = await makeUser();
    await db().insert(s.goals).values({ userId: b.id, level: "year", title: "B's secret goal", startDate: "2026-01-01", targetDate: "2026-12-31" });
    const exp = await exportUserData(a.id);
    expect(exp.goals).toHaveLength(0);
    expect(JSON.stringify(exp)).not.toContain("secret");
    await expect(deleteAccount(b.id, "wrong")).rejects.toBeInstanceOf(AccountError);
    await deleteAccount(b.id, "correct-horse-battery");
    expect(await db().select().from(s.goals)).toHaveLength(0);
  });
});
