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

test("Ctrl+C does not stamp the float into the canvas", async ({ page }) => {
    await bootApp(page);
    // Paint A at (0,1), lift it — canvas[0,1] reverts to B baseline.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await dragCells(page, 0, 1, 0, 1);
    // Copy. Old behaviour stamped the float content back into canvas[0,1].
    await page.keyboard.press("Control+c");
    // Move the float right to reveal the underlying canvas cell (0,1).
    await page.keyboard.press("ArrowRight");
    const c = await cellCoord(page, 0, 1);
    const [r] = await pixelRGB(page, c.cx, c.cy);
    expect(r).toBeGreaterThan(200);   // still B — Ctrl+C must not stamp
});

test("Ctrl+X does not clear canvas where content differs from the float", async ({ page }) => {
    await bootApp(page);
    // Paint A at (3,1) — canvas[3,1] = A (row 1 baseline = B, so A is non-baseline).
    await page.keyboard.press("p");
    await clickCell(page, 3, 1);
    // Select (1,1) — baseline B → float = B.
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    // Move float right × 2 → float at (3,1). float=B, canvas[3,1]=A → mismatch.
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    // Ctrl+X: float(B) ≠ canvas(A) → must NOT clear (3,1).
    await page.keyboard.press("Control+x");
    const c = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // A still there
});

test("Delete does not clear canvas where content differs from the float", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 3, 1);   // canvas[3,1] = A
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);   // float = B
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");   // float → (3,1); float=B, canvas=A
    await page.keyboard.press("Delete");
    // Move float away to expose canvas[3,1]
    await page.keyboard.press("ArrowRight");
    const c = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, c.cx, c.cy)).toEqual([0, 0, 0]);   // A still there
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
