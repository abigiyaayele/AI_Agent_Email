import AxeBuilder from "@axe-core/playwright";
import { expect, test } from "@playwright/test";

const PAGES = ["/dashboard", "/today", "/calendar", "/tasks", "/goals", "/plan/week", "/notes", "/time", "/analytics", "/assistant", "/notifications", "/settings"];

test("sign-in page has no serious accessibility violations", async ({ browser }) => {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  await page.goto("/login");
  const res = await new AxeBuilder({ page }).analyze();
  expect(res.violations.filter((v) => v.impact === "serious" || v.impact === "critical")).toEqual([]);
  await ctx.close();
});

test("key pages have no serious accessibility violations and fit the screen", async ({ page }) => {
  for (const path of PAGES) {
    await page.goto(path);
    const res = await new AxeBuilder({ page }).analyze();
    const serious = res.violations.filter((v) => v.impact === "serious" || v.impact === "critical").map((v) => `${path}: ${v.id} (${v.nodes.length}) ${v.help}`);
    expect(serious, serious.join("\n")).toEqual([]);
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - window.innerWidth);
    expect(overflow, `${path} scrolls sideways`).toBeLessThanOrEqual(1);
  }
});
