// Painting flows: pencil paints, fill flood-fills, eraser restores
// baseline. Pixel-level assertions go through `getImageData`.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

const COLOR_A: [number, number, number] = [0, 0, 0];   // default colour A = #000
const COLOR_B: [number, number, number] = [255, 255, 255]; // default colour B = #fff

// Default 9×9 row pattern. Row 0 natural baseline = A; row 1 = B; etc.
// We pick cell (1, 1) — row 1 — to verify pencil overwrites the B
// baseline with A on a left-click.

test("pencil left-click paints with the primary colour", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 1, 1);
    const { cx, cy } = await cellCoord(page, 1, 1);
    const [r, g, b] = await pixelRGB(page, cx, cy);
    // Primary = A = #000000
    expect([r, g, b]).toEqual(COLOR_A);
});

test("pencil right-click paints with the secondary colour", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1, { button: "right" });
    const { cx, cy } = await cellCoord(page, 0, 1);
    const [r, g, b] = await pixelRGB(page, cx, cy);
    // Secondary = B = #ffffff
    expect([r, g, b]).toEqual(COLOR_B);
});

test("eraser restores the natural baseline", async ({ page }) => {
    await bootApp(page);
    // Paint cell (0, 0) with B (overrides row 0's A baseline).
    await page.keyboard.press("p");
    await clickCell(page, 0, 0, { button: "right" });
    // Switch to eraser, left-click → restore baseline.
    await page.keyboard.press("e");
    await clickCell(page, 0, 0);
    const { cx, cy } = await cellCoord(page, 0, 0);
    const [r, g, b] = await pixelRGB(page, cx, cy);
    expect([r, g, b]).toEqual(COLOR_A);   // row 0 baseline = A
});

test("undo reverts the last paint", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    // Paint a deliberately wrong cell — row 1's natural is B, we paint A.
    await clickCell(page, 1, 1);
    const c = await cellCoord(page, 1, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(COLOR_A);
    await page.keyboard.press("Control+z");
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(COLOR_B);
});
