import { expect, test } from "@playwright/test";
import { expectNoHorizontalScroll, quickAdd } from "./helpers";

test.describe.configure({ mode: "serial" });

test("plan a day: tasks, overlap protection, completion and the daily summary", async ({ page }) => {
  const tomorrow = new Date(Date.now() + 86_400_000).toISOString().slice(0, 10);
  const tag = Date.now().toString(36);
  await page.goto(`/today?date=${tomorrow}`);
  await expectNoHorizontalScroll(page);

  await quickAdd(page, `Write report ${tag}`, { time: "10:00", minutes: 60 });
  await expect(page.getByRole("link", { name: `Write report ${tag}` }).first()).toBeVisible();

  await quickAdd(page, `Call bank ${tag}`, { time: "10:30", minutes: 30 });
  await expect(page.getByText(/overlaps/)).toBeVisible();

  await quickAdd(page, `Read chapter ${tag}`, { time: "14:00", minutes: 45 });
  await expect(page.getByRole("link", { name: `Read chapter ${tag}` }).first()).toBeVisible();

  await page.getByRole("checkbox", { name: `Mark Write report ${tag} done` }).first().click();
  await expect(page.getByRole("checkbox", { name: new RegExp(`Write report ${tag}`) }).first()).toBeChecked();

  await page.goto(`/plan/day?date=${tomorrow}`);
  await page.getByRole("button", { name: /Summarise/ }).click();
  const summary = page.locator(".whitespace-pre-line");
  await expect(summary).toContainText(`Write report ${tag}`);
  await expect(summary).toContainText(`Read chapter ${tag}`);
  await expectNoHorizontalScroll(page);

  await page.goto(`/calendar?view=week&date=${tomorrow}`);
  await expect(page.getByTitle(new RegExp(`Read chapter ${tag}`))).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("focus timer survives a reload and records the session", async ({ page }) => {
  await page.goto("/today");
  await quickAdd(page, "Deep work", { minutes: 25 });
  await page.getByRole("link", { name: "Deep work" }).first().click();
  await expect(page).toHaveURL(/\/tasks\//);

  await page.getByRole("button", { name: "Start focus timer" }).click();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();
  await page.reload();
  await expect(page.getByRole("button", { name: "Pause timer" })).toBeVisible();

  await page.getByRole("button", { name: "Pause timer" }).click();
  await expect(page.getByRole("button", { name: "Resume timer" })).toBeVisible();
  await page.getByRole("button", { name: "Finish timer" }).click();
  await page.getByPlaceholder("What did you get done?").fill("outlined section 1");
  await page.getByRole("button", { name: "Save session" }).click();
  await expect(page.getByText("outlined section 1")).toBeVisible();
});

test("notes autosave and are searchable", async ({ page }) => {
  await page.goto("/notes");
  await page.getByRole("button", { name: "New note" }).click();
  await expect(page).toHaveURL(/\/notes\/[0-9a-f-]{36}/);
  await page.getByLabel("Title").fill("Spanish verbs");
  await page.getByLabel("Note text").fill("Irregular preterite: tuve, estuve, hice");
  await expect(page.getByRole("status").filter({ hasText: /^Saved/ })).toBeVisible({ timeout: 10_000 });
  await page.reload();
  await expect(page.getByLabel("Note text")).toHaveValue(/estuve/);

  await page.goto("/notes?q=preter");
  await expect(page.getByRole("heading", { name: "Spanish verbs" })).toBeVisible();
  await expectNoHorizontalScroll(page);
});

test("custom reminders can be created and paused", async ({ page }) => {
  await page.goto("/notifications?tab=reminders");
  await page.getByLabel("Title").fill("Drink water");
  await page.getByLabel("Repeat").selectOption("daily");
  await page.getByRole("button", { name: "Create reminder" }).click();
  await expect(page.getByText("Reminder created.")).toBeVisible();
  const row = page.locator("li", { hasText: "Drink water" });
  await row.getByRole("button", { name: "Pause reminder" }).click();
  await expect(row.getByText(/paused/)).toBeVisible();
  await expectNoHorizontalScroll(page);
});
