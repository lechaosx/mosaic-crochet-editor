import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, pixelRGB, touchDragCells, touchPanZoom } from "./_helpers";

test("single-finger drag paints", async ({ page }) => {
    await bootApp(page);
    await touchDragCells(page, 1, 1, 3, 1);

    for (let x = 1; x <= 3; x++) {
        const p = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, p.cx, p.cy)).toEqual([0, 0, 0]);
    }
});

test("system pointer cancellation restores the stroke without adding history", async ({ page }) => {
    await bootApp(page);
    const point = await cellCoord(page, 1, 1);
    const before = await pixelRGB(page, point.cx, point.cy);
    const session = await page.context().newCDPSession(page);

    await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: point.cx, y: point.cy, id: 0 }],
    });
    expect(await pixelRGB(page, point.cx, point.cy)).toEqual([0, 0, 0]);

    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await session.detach();

    expect(await pixelRGB(page, point.cx, point.cy)).toEqual(before);
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history-v4")!).snapshots.length,
    )).toBe(1);
});

test("two-finger drag and pinch changes the view without leaving a paint mark", async ({ page }) => {
    await bootApp(page);
    const a = await cellCoord(page, 1, 1);
    const b = await cellCoord(page, 5, 1);
    const before = await page.evaluate(() => ({
        a: window.__test_matrix__!.a,
        e: window.__test_matrix__!.e,
        f: window.__test_matrix__!.f,
    }));

    await touchPanZoom(page, [a, b], [
        { cx: a.cx + 20, cy: a.cy + 25 },
        { cx: b.cx + 55, cy: b.cy + 25 },
    ]);

    const after = await page.evaluate(() => ({
        a: window.__test_matrix__!.a,
        e: window.__test_matrix__!.e,
        f: window.__test_matrix__!.f,
    }));
    expect(after).not.toEqual(before);
    const source = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, source.cx, source.cy)).not.toEqual([0, 0, 0]);
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history-v4")!).snapshots.length,
    )).toBe(1);
});

test("Mask move toggle supports a modifier-free touch drag", async ({ page }) => {
    await bootApp(page);
    const painted = await cellCoord(page, 1, 1);
    await page.touchscreen.tap(painted.cx, painted.cy);
    await page.getByRole("button", { name: "Select" }).tap();
    await page.touchscreen.tap(painted.cx, painted.cy);
    await page.getByRole("button", { name: "Mask move" }).tap();

    await touchDragCells(page, 1, 1, 3, 1);

    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual([0, 0, 0]);
});
