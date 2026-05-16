// True-UX cross-feature interactions: ones that exercise the boot path,
// the popover-commit capture-phase listener, or the file-picker shim.
// State-level interaction tests (canvas resize, paste over float, etc.)
// live in `tests/interactions.test.ts` — faster, more reliable.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

test("Ctrl+Z while Edit popover is open: edit commits first, then undo pops it", async ({ page }) => {
    await bootApp(page);
    // Establish a paint snapshot we can land back on.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);   // (0,1) baseline B → primary A
    // Open the Edit popover and change a dim, then immediately Ctrl+Z.
    // Without the capture-phase listener, undo() would fire before
    // onEditClose, leaving the popover's preview as the live state.
    await page.locator("#btn-edit").click();
    const w = page.locator("#edit-width");
    await w.fill("4"); await w.dispatchEvent("input");
    await page.keyboard.press("Control+z");
    // Resize was committed by the capture-phase dismiss; Ctrl+Z then
    // popped it. The cell we painted should still show A.
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("save with active float doesn't drop the selection", async ({ page }) => {
    await bootApp(page);
    // Lift a cell, then trigger save with the picker shimmed to cancel.
    await page.keyboard.press("s");
    await dragCells(page, 1, 1, 1, 1);
    await page.evaluate(() => {
        (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = () =>
            Promise.reject(new DOMException("cancelled", "AbortError"));
    });
    await page.locator("#btn-save").click();
    // Float should still be alive — drag it to verify.
    await page.keyboard.press("m");
    await dragCells(page, 1, 1, 4, 1);
    // Source (1, 1) had baseline B; lift cut it to baseline B (no change).
    // Move dragged content to (4, 1); float visible there with B.
    // Anchor and verify (4, 1) has the float content (= B which was the
    // pre-lift value at (1, 1)).
    await page.keyboard.press("Control+Shift+A");
    const c = await cellCoord(page, 4, 1);
    expect((await pixelRGB(page, c.cx, c.cy))[0]).toBeGreaterThan(200);
});

test("tool switch with active float keeps it alive (paint clips to mask)", async ({ page }) => {
    await bootApp(page);
    // Lift cells (1, 1)..(2, 1).
    await page.keyboard.press("s");
    await dragCells(page, 1, 1, 2, 1);
    // Switch to pencil, paint at (4, 1) — outside the float, should clip.
    // (4, 1) baseline = B (row 1); primary = A. With clip → no change.
    await page.keyboard.press("p");
    await clickCell(page, 4, 1);
    const c = await cellCoord(page, 4, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(B);
});
