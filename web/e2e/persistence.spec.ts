// Persistence + boot-time consistency checks.
import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];

test("paint, reload, content survives via localStorage", async ({ page }) => {
    await bootApp(page);
    // Paint a recognisable cell (0, 1) = primary A (cell baseline is B).
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    // Reload — vite preview serves the same bundle.
    await page.reload();
    // Wait for the app to fully re-render.
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("active float survives a reload (it lives in SessionState)", async ({ page }) => {
    await bootApp(page);
    // Lift a cell so a float exists.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await page.mouse.down();
    const a = await cellCoord(page, 0, 1);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.up();
    // Reload.
    await page.reload();
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    // Move tool should still find the float (drag it to verify).
    await page.keyboard.press("m");
    const src = await cellCoord(page, 0, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    // Anchor and verify the lifted content landed at (3, 1).
    await page.keyboard.press("Control+Shift+A");
    const c = await cellCoord(page, 3, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("__test_matrix__ stays fresh across view changes (rotation updates the matrix)", async ({ page }) => {
    await bootApp(page);
    const m1 = await page.evaluate(() => {
        const m = (window as { __test_matrix__?: DOMMatrix }).__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    // Rotate the canvas; the matrix's a/b/c/d coefficients should change.
    await page.keyboard.press("r");
    await page.waitForTimeout(400);   // let the animation settle
    const m2 = await page.evaluate(() => {
        const m = (window as { __test_matrix__?: DOMMatrix }).__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    // At least one rotation-related coefficient changed.
    const moved = m1.some((v, i) => Math.abs(v - m2[i]) > 1e-3);
    expect(moved).toBe(true);
});

test("rapid state changes during marching-ants animation don't tear: final state coherent", async ({ page }) => {
    // The marching-ants rAF loop reads `rs.lastStore` and the live float.
    // Synchronous state changes shouldn't leave the renderer in a bad
    // intermediate. We simulate by firing rapid Ctrl+Z/Ctrl+Y oscillations
    // while a selection is alive (marching-ants animating).
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    const a = await cellCoord(page, 0, 1);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.down();
    await page.mouse.up();
    // Fire 20 undo/redo cycles back-to-back.
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+y");
    }
    // App should still respond; verify the canvas is renderable and the
    // last-known cell still has the painted colour.
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});
