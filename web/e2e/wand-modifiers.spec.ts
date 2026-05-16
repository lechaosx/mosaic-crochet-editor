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

// The Ctrl+wand-click "remove" semantic is reliably covered at the
// state level in `tests/interactions.test.ts` (wand-add-then-remove
// chain). E2E coverage for that variant ran into the alternating-row
// connectivity making the wand pick too broad a region to isolate.
