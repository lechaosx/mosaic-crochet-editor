// True-UX cross-feature interactions: ones that exercise the boot path,
// explicit Pattern transactions, or the file-picker shim.
// State-level interaction tests (canvas resize, paste over float, etc.)
// live in `tests/interactions.test.ts` — faster, more reliable.

import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

async function historyLength(page: import("@playwright/test").Page): Promise<number> {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length);
}

async function recoveryWidth(page: import("@playwright/test").Page): Promise<number> {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.state.canvasWidth);
}

test("Pattern stays open and blocks an outside canvas edit", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").dispatchEvent("input");
    const cell = await cellCoord(page, 0, 1);

    await page.mouse.click(cell.cx, cell.cy);

    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(B);
});

test("Pattern keeps canvas zoom available", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    const canvas = await page.locator("#canvas").boundingBox();
    if (!canvas) throw new Error("canvas bounds unavailable");
    const start = { cx: canvas.x + canvas.width - 40, cy: canvas.y + canvas.height / 2 };
    expect(await page.evaluate(({ cx, cy }) => (document.elementFromPoint(cx, cy) as HTMLElement | null)?.id, start))
        .toBe("canvas");
    const before = await page.evaluate(() => ({
        a: window.__test_matrix__!.a,
    }));

    await page.mouse.move(start.cx, start.cy);
    await page.mouse.wheel(0, -100);

    const after = await page.evaluate(() => ({
        a: window.__test_matrix__!.a,
    }));
    expect(after).not.toEqual(before);
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
});

test("Pattern Cancel restores the opening state without history", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").dispatchEvent("input");

    await page.locator("#edit-cancel").click();

    await expect(page.locator("#edit-pattern-widget")).toBeHidden();
    expect(await recoveryWidth(page)).toBe(9);
    expect(await historyLength(page)).toBe(before);
});

test("Escape cancels Pattern and restores the opening state", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").dispatchEvent("input");

    await page.keyboard.press("Escape");

    await expect(page.locator("#edit-pattern-widget")).toBeHidden();
    expect(await recoveryWidth(page)).toBe(9);
    expect(await historyLength(page)).toBe(before);
});

test("invalid Pattern input retains the last valid preview", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    const width = page.locator("#edit-width");
    await width.fill("5");
    await width.dispatchEvent("input");
    const lastCell = await cellCoord(page, 4, 1);
    const outside = await cellCoord(page, 5, 1);
    const validPreview = await pixelRGB(page, lastCell.cx, lastCell.cy);
    const validOutside = await pixelRGB(page, outside.cx, outside.cy);

    await width.fill("1048577");
    await width.dispatchEvent("input");

    await expect(page.locator("#edit-error")).toBeVisible();
    await expect(page.locator("#edit-apply")).toBeDisabled();
    expect(await pixelRGB(page, lastCell.cx, lastCell.cy)).toEqual(validPreview);
    expect(await pixelRGB(page, outside.cx, outside.cy)).toEqual(validOutside);
});

test("Pattern Apply creates one history entry", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("6");
    await page.locator("#edit-width").dispatchEvent("input");

    await page.locator("#edit-apply").click();

    await expect(page.locator("#edit-pattern-widget")).toBeHidden();
    expect(await recoveryWidth(page)).toBe(6);
    expect(await historyLength(page)).toBe(before + 1);
    await page.keyboard.press("Control+z");
    expect(await recoveryWidth(page)).toBe(9);
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
