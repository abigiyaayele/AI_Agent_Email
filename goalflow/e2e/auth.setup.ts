import { test as setup } from "@playwright/test";
import { register } from "./helpers";

// One fresh account per device project, so device runs never see each other's data.
for (const project of ["desktop", "mobile", "tablet"]) {
  setup(`create ${project} account`, async ({ page }) => {
    await register(page);
    await page.context().storageState({ path: `e2e/.auth/${project}.json` });
  });
}
