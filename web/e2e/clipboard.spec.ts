// Copy / cut / paste flows. Verifies via canvas pixel inspection.
import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

test("Ctrl+X clears the canvas under the float and drops the selection", async ({ page }) => {
    await bootApp(page);
    // Paint cell (0, 1) with A so it differs from its B baseline.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    // Select that cell.
    await page.keyboard.press("s");
    await dragCells(page, 0, 1, 0, 1);
    // Cut — canvas under should clear to baseline B.
    await page.keyboard.press("Control+x");
    const c = await cellCoord(page, 0, 1);
    const [r] = await pixelRGB(page, c.cx, c.cy);
    expect(r).toBeGreaterThan(200);   // baseline B
});

test("Ctrl+C stamps the float into the canvas (keeps selection alive)", async ({ page }) => {
    await bootApp(page);
    // Cell (0, 1): baseline B; paint A; lift; copy; verify cell stays A.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await dragCells(page, 0, 1, 0, 1);
    await page.keyboard.press("Control+c");
    const c = await cellCoord(page, 0, 1);
    const [r, g, b] = await pixelRGB(page, c.cx, c.cy);
    expect([r, g, b]).toEqual(A);   // still A (the lifted content stamped back)
});

test("Cut then paste restores the content at the same position", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");
    await dragCells(page, 2, 1, 2, 1);
    await page.keyboard.press("Control+x");
    const c = await cellCoord(page, 2, 1);
    expect((await pixelRGB(page, c.cx, c.cy))[0]).toBeGreaterThan(200);   // cleared to B
    await page.keyboard.press("Control+v");
    // The paste creates a non-destructive float — canvas underneath is
    // unchanged (still B baseline). To verify the paste's content is
    // there, anchor the float (deselect):
    await page.keyboard.press("Control+Shift+A");
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});
