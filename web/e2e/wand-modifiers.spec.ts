// Wand-tool modifier chain via real pointer events. Vitest verifies the
// state-level math; this spec verifies the modifier-with-mouse-click
// wiring (gesture event → modifier capture in `onPaintStart`).

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

test("Shift+wand-click adds a second region to the existing selection", async ({ page }) => {
    await bootApp(page);
    // Paint A at two disconnected cells on row 1 (baseline B). Two
    // separate single-cell regions for the wand.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await clickCell(page, 4, 1);
    // Wand: pick the first region (replace mode).
    await page.keyboard.press("w");
    await clickCell(page, 0, 1);
    // Shift+wand: add the second region.
    await clickCell(page, 4, 1, { modifiers: ["Shift"] });
    // Both should now be in the float. Move tool: drag from (0,1) by +1,0;
    // both lifted cells should move together — assert by anchoring and
    // checking (1, 1) AND (5, 1) both end up as A.
    await page.keyboard.press("m");
    await dragCells(page, 0, 1, 1, 1);
    await page.keyboard.press("Control+Shift+A");
    const c1 = await cellCoord(page, 1, 1);
    const c5 = await cellCoord(page, 5, 1);
    expect((await pixelRGB(page, c1.cx, c1.cy))).toEqual(A);
    expect((await pixelRGB(page, c5.cx, c5.cy))).toEqual(A);
});

test("one wand sweep creates one undoable selection edit", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await clickCell(page, 4, 1);
    await page.keyboard.press("w");
    const historyBefore = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    );

    await dragCells(page, 0, 1, 4, 1);

    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    )).toBe(historyBefore + 1);

    await page.keyboard.press("Control+z");
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.float,
    )).toBeNull();
    for (const x of [0, 4]) {
        const cell = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(A);
    }
});

test("visible Select and Wand modes latch within the group and reset after leaving", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Selection actions" }).click();
    const modes = page.getByRole("group", { name: "Selection mode" });
    await expect(modes).toBeVisible();
    await expect(modes.getByRole("button", { name: "Replace" })).toHaveAttribute("aria-pressed", "true");
    await expect(modes.getByRole("button", { name: "Subtract" })).toHaveAttribute("aria-disabled", "true");
    await modes.getByRole("button", { name: "Add" }).click();
    await expect(modes.getByRole("button", { name: "Add" })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Magic wand" }).click();
    await expect(modes.getByRole("button", { name: "Add" })).toHaveAttribute("aria-pressed", "true");
    await page.getByRole("button", { name: "Pencil" }).click();
    await expect(modes).toBeHidden();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Selection actions" }).click();
    await expect(modes.getByRole("button", { name: "Replace" })).toHaveAttribute("aria-pressed", "true");
});

test("visible Add and Subtract change the lifted selection without modifiers", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Selection actions" }).click();
    const modes = page.getByRole("group", { name: "Selection mode" });
    await clickCell(page, 1, 1);
    await modes.getByRole("button", { name: "Add" }).click();
    await clickCell(page, 3, 1);
    await expect(page.locator("#status-selection")).toHaveText("2 selected");
    await modes.getByRole("button", { name: "Subtract" }).click();
    await clickCell(page, 1, 1);
    await expect(page.locator("#status-selection")).toHaveText("1 selected");
});

test("Shift temporarily overrides visible Subtract and restores its latched state", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Selection actions" }).click();
    const modes = page.getByRole("group", { name: "Selection mode" });
    await clickCell(page, 1, 1);
    await modes.getByRole("button", { name: "Subtract" }).click();
    await clickCell(page, 3, 1, { modifiers: ["Shift"] });
    await expect(page.locator("#status-selection")).toHaveText("2 selected");
    await expect(modes.getByRole("button", { name: "Subtract" })).toHaveAttribute("aria-pressed", "true");
});

test("Subtract resets when its final selected cell is removed", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Selection actions" }).click();
    const modes = page.getByRole("group", { name: "Selection mode" });
    await clickCell(page, 1, 1);
    await modes.getByRole("button", { name: "Subtract" }).click();
    await clickCell(page, 1, 1);
    await expect(modes.getByRole("button", { name: "Replace" })).toHaveAttribute("aria-pressed", "true");
    await expect(modes.getByRole("button", { name: "Subtract" })).toHaveAttribute("aria-disabled", "true");
});

// The Ctrl+wand-click "remove" semantic is reliably covered at the
// state level in `tests/interactions.test.ts` (wand-add-then-remove
// chain). E2E coverage for that variant ran into the alternating-row
// connectivity making the wand pick too broad a region to isolate.
