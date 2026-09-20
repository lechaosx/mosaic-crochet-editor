import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, pixelRGB } from "./_helpers";

test("hover reports only coordinates and never previews a paint result", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");
    const source = await cellCoord(page, 0, 1);
    const mirrored = await cellCoord(page, 8, 1);
    const beforeSource = await pixelRGB(page, source.cx, source.cy);
    const beforeMirrored = await pixelRGB(page, mirrored.cx, mirrored.cy);

    await page.mouse.move(source.cx, source.cy);

    expect(await pixelRGB(page, source.cx, source.cy)).toEqual(beforeSource);
    expect(await pixelRGB(page, mirrored.cx, mirrored.cy)).toEqual(beforeMirrored);
    await expect(page.locator("#status-coordinates")).toHaveText("0, 1");
    await expect(page.locator("#status-feedback")).toBeHidden();
});

test("Overlay exposes touch actions while right-click performs the opposite place/clear action", async ({ page }) => {
    await bootApp(page);
    const place = page.getByRole("button", { name: "Place overlay" });
    const clear = page.getByRole("button", { name: "Clear overlay" });
    const invert = page.getByRole("button", { name: "Invert overlay" });
    await expect(place).toBeVisible();
    await expect(clear).toBeVisible();
    await expect(invert).toBeVisible();

    const target = await cellCoord(page, 2, 1);
    const before = await pixelRGB(page, target.cx, target.cy);
    await place.click();
    await page.mouse.click(target.cx, target.cy);
    expect(await pixelRGB(page, target.cx, target.cy)).not.toEqual(before);
    await page.mouse.click(target.cx, target.cy, { button: "right" });
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual(before);

    await clear.click();
    await page.mouse.click(target.cx, target.cy, { button: "right" });
    expect(await pixelRGB(page, target.cx, target.cy)).not.toEqual(before);
    await page.mouse.click(target.cx, target.cy);
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual(before);

    await page.keyboard.press("Shift+O");
    await expect(clear).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("o");
    await expect(place).toHaveAttribute("aria-pressed", "true");

    await invert.click();
    await page.mouse.click(target.cx, target.cy, { button: "right" });
    expect(await pixelRGB(page, target.cx, target.cy)).not.toEqual(before);
    await page.mouse.click(target.cx, target.cy);
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual(before);
});
