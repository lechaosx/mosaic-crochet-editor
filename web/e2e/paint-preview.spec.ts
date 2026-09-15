import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

test("Pencil hover previews exact live mirror destinations without editing", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");
    const before = await page.evaluate(() => localStorage.getItem("mosaic-recovery"));
    const target = await cellCoord(page, 0, 1);
    await page.mouse.move(target.cx, target.cy);
    await expect(page.locator("#status-feedback")).toContainText("2 cells will change");
    await expect(page.locator("#status-feedback")).toContainText("0, 1");
    await expect(page.locator("#status-feedback")).toContainText("8, 1");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBe(before);
    const mirrored = await cellCoord(page, 8, 1);
    const previewColor = await pixelRGB(page, mirrored.cx, mirrored.cy);
    await clickCell(page, 0, 1);
    expect(await pixelRGB(page, mirrored.cx, mirrored.cy)).toEqual(previewColor);
});

test("Pencil hover distinguishes an unchanged mirror destination", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 8, 1);
    await page.keyboard.press("v");
    const target = await cellCoord(page, 0, 1);
    await page.mouse.move(target.cx, target.cy);
    await expect(page.locator("#status-feedback")).toContainText("1 cell will change");
    await expect(page.locator("#status-feedback")).toContainText("1 destination unchanged or skipped");
});

test("Eraser and Invert preview current one-cell outcomes", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 2, 1);
    const target = await cellCoord(page, 2, 1);

    await page.keyboard.press("e");
    await page.mouse.move(target.cx, target.cy);
    await expect(page.locator("#status-feedback")).toContainText("1 cell will change");

    await page.keyboard.press("i");
    await page.mouse.move(target.cx, target.cy);
    await expect(page.locator("#status-feedback")).toContainText("1 cell will change");
});

test("Overlay preview names its inward support and explains an unavailable target", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("o");
    const valid = await cellCoord(page, 2, 1);
    await page.mouse.move(valid.cx, valid.cy);
    await expect(page.locator("#status-feedback")).toContainText("support 2, 2");
    await expect(page.locator("#status-feedback")).toContainText("1 cell will change");
    const previewGlyph = await pixelRGB(page, valid.cx, valid.cy);
    await clickCell(page, 2, 1);
    expect(await pixelRGB(page, valid.cx, valid.cy)).toEqual(previewGlyph);

    const foundation = await cellCoord(page, 2, 8);
    await page.mouse.move(foundation.cx, foundation.cy);
    await expect(page.locator("#status-feedback")).toContainText("No inward supporting cell");
});
