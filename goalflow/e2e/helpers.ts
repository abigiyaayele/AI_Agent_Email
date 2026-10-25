import { expect, type Page } from "@playwright/test";

export const PASSWORD = "correct horse battery staple";

export async function register(page: Page, name = "Kido") {
  const email = `e2e-${Date.now()}-${Math.random().toString(36).slice(2, 7)}@example.com`;
  await page.goto("/register");
  await page.getByLabel("Name").fill(name);
  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: /create account/i }).click();
  await expect(page).toHaveURL(/\/(settings|dashboard)/);
  return email;
}

export async function quickAdd(page: Page, title: string, opts: { time?: string; minutes?: number } = {}) {
  await page.getByLabel("New task title").fill(title);
  if (opts.time) await page.getByLabel("Start time (optional)").fill(opts.time);
  if (opts.minutes) await page.getByLabel("Estimated minutes").fill(String(opts.minutes));
  await page.getByRole("button", { name: "Add", exact: true }).click();
}

/** The page must never scroll sideways (mobile layout check). */
export async function expectNoHorizontalScroll(page: Page) {
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
  expect(overflow).toBeLessThanOrEqual(1);
}
