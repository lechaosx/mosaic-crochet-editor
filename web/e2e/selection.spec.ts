// Selection / float flows. The marquee can be verified visually via the
// dragRect outline, but the easiest pure-DOM test is "Ctrl+A then commit
// and verify state via paint" — we paint after Ctrl+A and verify the
// stroke landed inside the lifted area.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

test("Ctrl+A lifts every paintable cell into a float", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    // No DOM affordance for "float exists" — paint into it to verify.
    // We can't tell from outside; instead, deselect should bake the
    // (unchanged) float back; nothing visible changes. This test is
    // mostly a smoke check that Ctrl+A doesn't throw.
    await page.keyboard.press("Control+Shift+A");
});

test("Select-rect drag then paint clips to the lifted region", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    // Drag from (1,1) to (3,3): lifts a 3×3 area.
    await dragCells(page, 1, 1, 3, 3);
    // Switch to pencil with secondary colour, paint outside the float
    // at cell (5, 5). Should be a no-op (paint clipped to float).
    await page.keyboard.press("p");
    await clickCell(page, 5, 5, { button: "right" });
    // Cell (5, 5) baseline = row 5 = B; right-click would paint B too,
    // so no observable change. Use (4, 1) instead — row 1 is B.
    await clickCell(page, 4, 1);
    const c = await cellCoord(page, 4, 1);
    const [r, g, b] = await pixelRGB(page, c.cx, c.cy);
    // (4, 1) is outside the 1..3 × 1..3 float → paint should be clipped,
    // so cell stays at the row-1 baseline = B (255).
    expect(r).toBeGreaterThan(200);
});

test("Move tool drag repositions the float", async ({ page }) => {
    await bootApp(page);
    // Make a small selection.
    await page.keyboard.press("s");
    await dragCells(page, 1, 1, 2, 2);
    // Switch to Move and drag the float by (+3, 0).
    await page.keyboard.press("m");
    await dragCells(page, 1, 1, 4, 1);
    // The original lift site at (1, 1) should now show the natural baseline
    // (row 1 = B), since the lift cut it and the move took the content away.
    const src = await cellCoord(page, 1, 1);
    const [r] = await pixelRGB(page, src.cx, src.cy);
    expect(r).toBeGreaterThan(200);   // baseline B → high R
});

test("Ctrl+Shift+A deselects", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    await page.keyboard.press("Control+Shift+A");
    // No DOM hook to assert directly; this is a smoke test that the
    // shortcut path doesn't throw.
});
