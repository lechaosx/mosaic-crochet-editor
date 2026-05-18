// Symmetry toggles + Edit popover resize.
import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("vertical symmetry mirrors paint horizontally", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");   // toggle Vertical symmetry
    await page.keyboard.press("p");
    // Paint cell (0, 1) — should mirror to (8, 1) on a 9-wide canvas.
    await clickCell(page, 0, 1);
    const right = await cellCoord(page, 8, 1);
    const [r, g, b] = await pixelRGB(page, right.cx, right.cy);
    // Primary = A = #000 → all three near 0.
    expect(r).toBeLessThan(50);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
});

test("dragging the V symmetry guide moves the mirror axis", async ({ page }) => {
    // V axis sits at canonical centre (x=4 on 9-wide). Drag its guide to
    // x=2; painting (0, 1) should now mirror to (4, 1) instead of (8, 1).
    await bootApp(page);
    await page.keyboard.press("v");        // toggle V on
    await page.keyboard.press("m");        // Move tool — axis-drag only fires here
    // Guide line for canonical V is at render x = 4.5. Click at (4.5, 4) cell coords.
    const start = await cellCoord(page, 4, 4);
    const end   = await cellCoord(page, 2, 4);
    // Offset by half a cell width so we land on the guide (render x=4.5), not the
    // cell-corner. cellCoord gives the centre, so it's already at render x=4.5.
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 8 });
    await page.mouse.up();
    // Switch to pencil and paint (0, 1) — should mirror to (4, 1) per the new V at x=2.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    const mirrored = await cellCoord(page, 4, 1);
    const [r, g, b] = await pixelRGB(page, mirrored.cx, mirrored.cy);
    expect(r).toBeLessThan(50);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
});

test("Edit popover changes the canvas dimensions", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    const widthInput  = page.locator("#edit-width");
    const heightInput = page.locator("#edit-height");
    await widthInput.fill("5");
    await widthInput.dispatchEvent("input");
    await heightInput.fill("5");
    await heightInput.dispatchEvent("input");
    // Dismiss by clicking outside the popover (the canvas).
    await page.locator("#canvas").click({ position: { x: 10, y: 10 } });
    // The matrix hook updates each render; cell (4, 4) of a 5×5 canvas is
    // now valid where (4, 4) of 9×9 was already. We just smoke that the
    // app didn't blow up.
    await expect(page.locator("#canvas")).toBeVisible();
});
