import { test, expect } from "@playwright/test";
import { bootApp, clickCell } from "./_helpers";

test("painting outside the selection explains the no-op and a valid edit clears it", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("p");

    await clickCell(page, 3, 1);
    await expect(page.locator("#status-feedback")).toHaveText("Outside selection");

    await clickCell(page, 1, 1, { button: "right" });
    await expect(page.locator("#status-feedback")).toBeHidden();
});

test("Move explains when no selection exists or the gesture starts outside it", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("m");
    await clickCell(page, 1, 1);
    await expect(page.locator("#status-feedback")).toHaveText("No selection");

    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    await clickCell(page, 3, 1);
    await expect(page.locator("#status-feedback")).toHaveText("Start inside selection");
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
    await expect(page.getByRole("checkbox", { name: "Prevent impossible overlay placements" })).toBeChecked();
    await page.keyboard.press("Escape");

    await clickCell(page, 1, 0, { button: "right" });
    await expect(page.locator("#status-feedback")).toHaveText("Protected · Settings");
});
