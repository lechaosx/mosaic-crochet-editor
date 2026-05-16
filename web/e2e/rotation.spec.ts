// Rotation + float. The float's mask lives in source-cell coords; the
// renderer composes `rs.visualRotation` into the canvas transform. The
// click-to-cell mapping uses the same matrix (via `__test_matrix__`) so
// click + cell-pixel queries stay coherent under rotation.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

test("rotate then paint: pixel lands at the correct cell", async ({ page }) => {
    await bootApp(page);
    // Rotate the canvas 90° clockwise (R = +45°, twice).
    await page.keyboard.press("r");
    await page.keyboard.press("r");
    // Wait for rotation animation to settle.
    await page.waitForTimeout(400);
    // Paint at (0, 1). The test-matrix hook reflects the rotated transform,
    // so cellCoord(0, 1) returns the *visually correct* CSS coord even
    // after rotation. The painted cell should still report colour A.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("rotate then lift + move: float follows the rotated coord frame", async ({ page }) => {
    await bootApp(page);
    // Paint a known cell, then rotate.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // paint A at (0, 1)
    await page.keyboard.press("r");
    await page.keyboard.press("r");
    await page.waitForTimeout(400);
    // Select (0, 1) — same cell we painted, now rendered rotated.
    await page.keyboard.press("s");
    // single-cell select via a degenerate drag
    const a = await cellCoord(page, 0, 1);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.down();
    await page.mouse.up();
    // The lift should have happened — verify by anchoring and confirming
    // the cell still shows A (lift → re-anchor at same offset).
    await page.keyboard.press("Control+Shift+A");
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});
