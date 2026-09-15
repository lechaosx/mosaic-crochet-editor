import { test, expect } from "@playwright/test";
import { bootApp, clickCell } from "./_helpers";

test("painting outside the selection explains the no-op and a valid edit clears it", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("p");

    await clickCell(page, 3, 1);
    await expect(page.locator("#status-feedback")).toHaveText("Outside selection · no cells changed");

    await clickCell(page, 1, 1, { button: "right" });
    await expect(page.locator("#status-feedback")).toBeHidden();
});

test("Move explains when no selection exists or the gesture starts outside it", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("m");
    await clickCell(page, 1, 1);
    await expect(page.locator("#status-feedback")).toHaveText("Select cells before using Move");

    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    await clickCell(page, 3, 1);
    await expect(page.locator("#status-feedback")).toHaveText("Start Move inside the selection");
});

test("Overlay explains geometrically unavailable targets", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("o");
    await clickCell(page, 1, 8);
    await expect(page.locator("#status-feedback")).toHaveText("No inward supporting cell");
});

test("locked cells explain why paint was rejected", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");

    await clickCell(page, 1, 0, { button: "right" });
    await expect(page.locator("#status-feedback")).toHaveText("Protected cell skipped · unlock in Settings");
});
