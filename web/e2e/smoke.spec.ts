// App-boot smoke: the page renders, the canvas is up, the toolbar exists,
// and the default tool is Pencil.
import { test, expect } from "@playwright/test";
import { bootApp } from "./_helpers";

test("app boots with default UI", async ({ page }) => {
    await bootApp(page);
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(page.locator("#tool-pencil")).toHaveClass(/btn--active/);
});
