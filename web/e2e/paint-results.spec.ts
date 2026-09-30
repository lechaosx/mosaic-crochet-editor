import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("Invert copies the clicked result across different mirror values and visits once per stroke", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 8, 1);
    await page.keyboard.press("v");
    await page.getByRole("button", { name: "Invert colours", exact: true }).click();
    const source = await cellCoord(page, 0, 1);
    const copy = await cellCoord(page, 8, 1);
    await page.mouse.move(source.cx, source.cy);
    await page.mouse.down();
    await page.mouse.move(copy.cx, copy.cy);
    await page.mouse.up();
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([0, 0, 0]);
});

test("Eraser synchronizes a differing repeat when the source is already natural", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-down").fill("1");
    await page.locator("#recipe-down").dispatchEvent("change");
    await page.getByRole("button", { name: "Eraser", exact: true }).click();
    await clickCell(page, 2, 1);
    const copy = await cellCoord(page, 2, 2);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([255, 255, 255]);
    await page.keyboard.press("Control+z");
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([0, 0, 0]);
});

test("Overlay rotates its edited supporting pixel with a saved selection", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 2);
    await page.locator("label:has(#recipe-mode-rotation)").click();
    await page.locator("#recipe-centre-x").fill("2");
    await page.locator("#recipe-centre-y").fill("2");
    await page.locator("label:has(#recipe-turn-90)").click();
    await page.getByRole("button", { name: "Place overlay" }).click();
    await clickCell(page, 1, 2);
    for (const [x, y] of [[1, 3], [1, 1]]) {
        const support = await cellCoord(page, x, y);
        expect(await pixelRGB(page, support.cx, support.cy), `${x},${y}`).toEqual([0, 0, 0]);
    }
    const localInward = await cellCoord(page, 2, 2);
    expect(await pixelRGB(page, localInward.cx, localInward.cy)).toEqual([0, 0, 0]);
});

test("Clear overlay in the gutter clears mirrored boundary supports", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 1, 0);
    await clickCell(page, 1, 8);
    await page.keyboard.press("h");
    await page.getByRole("button", { name: "Clear overlay" }).click();
    await clickCell(page, 1, -1);
    for (const y of [0, 8]) {
        const support = await cellCoord(page, 1, y);
        expect(await pixelRGB(page, support.cx, support.cy), `1,${y}`).toEqual([0, 0, 0]);
    }
});
