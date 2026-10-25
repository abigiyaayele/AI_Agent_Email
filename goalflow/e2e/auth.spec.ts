import { expect, test } from "@playwright/test";
import { PASSWORD, register } from "./helpers";

test.use({ storageState: { cookies: [], origins: [] } });

test("sign up, sign out, reject a wrong password, sign back in", async ({ page, isMobile }) => {
  const email = await register(page);

  if (isMobile) await page.getByRole("button", { name: "Open menu" }).click();
  await page.getByRole("button", { name: "Sign out" }).click();
  await expect(page).toHaveURL(/\/login/);

  await page.goto("/today");
  await expect(page).toHaveURL(/\/login/);

  await page.getByLabel("Email").fill(email);
  await page.getByLabel("Password").fill("wrong password!!");
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page.getByText("Email or password is incorrect.")).toBeVisible();

  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/(dashboard|today)/);
});
