import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

test("canvas Arrow and Space keys do not create a keyboard paint cursor", async ({ page }) => {
    await bootApp(page);
    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    const target = await cellCoord(page, 4, 4);
    const before = await pixelRGB(page, target.cx, target.cy);

    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Space");

    expect(await pixelRGB(page, target.cx, target.cy)).toEqual(before);
    await expect(page.getByRole("status", { name: "Keyboard cell" })).toHaveCount(0);
    await expect(page.locator("#status-coordinates")).toBeHidden();
});

test("Arrow shortcuts still move an active selection", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");

    const destination = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([0, 0, 0]);
});
