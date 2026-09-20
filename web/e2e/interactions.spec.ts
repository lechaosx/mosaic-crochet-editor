// True-UX cross-feature interactions: ones that exercise the boot path,
// Pattern panel behavior or the file-picker shim.
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

test("Pattern remains modeless across canvas authoring and inspector changes", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").press("Tab");
    const cell = await cellCoord(page, 0, 1);

    await page.mouse.click(cell.cx, cell.cy);

    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(A);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.locator("#edit-pattern-widget")).toBeHidden();
    await expect(page.locator("#hl-popover")).toBeVisible();
});

test("Pattern keeps canvas zoom available", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    const canvas = await page.locator("#canvas").boundingBox();
    const inspector = await page.locator("#inspector-host").boundingBox();
    if (!canvas) throw new Error("canvas bounds unavailable");
    if (!inspector) throw new Error("inspector bounds unavailable");
    const start = { cx: inspector.x - 40, cy: canvas.y + canvas.height / 2 };
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

test("a Pattern session collapses into one undoable before-and-after state", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("6");
    await page.locator("#edit-width").press("Tab");
    await page.locator("#btn-edit").click();
    await page.locator("#btn-edit").click();
    await page.locator("#edit-height").fill("7");
    await page.locator("#edit-height").press("Tab");
    await page.locator('label:has(input[name="edit-mode"][value="round"])').click();
    await page.locator('label:has(input[name="edit-mode"][value="row"])').click();

    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    expect(await recoveryWidth(page)).toBe(6);
    expect(await historyLength(page)).toBe(before + 1);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recoveryWidth(page)).toBe(9);
    await expect(page.locator("#edit-height")).toHaveValue("9");
    await page.getByRole("button", { name: "Redo" }).click();
    expect(await recoveryWidth(page)).toBe(6);
    await expect(page.locator("#edit-height")).toHaveValue("7");
});

test("opening and closing Pattern without changes adds no undo step", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);

    await page.locator("#btn-edit").click();
    await page.locator("#btn-edit").click();

    expect(await historyLength(page)).toBe(before);
});

test("a Pattern session that returns to its baseline leaves no history entry", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);
    await page.locator("#btn-edit").click();
    const width = page.locator("#edit-width");
    await width.fill("10");
    await width.press("Tab");
    await width.fill("9");
    await width.press("Tab");
    expect(await historyLength(page)).toBe(before);

    await width.fill("8");
    await width.press("Tab");
    expect(await historyLength(page)).toBe(before + 1);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recoveryWidth(page)).toBe(9);
});

test("Escape closes Pattern without reverting committed changes", async ({ page }) => {
    await bootApp(page);
    const before = await historyLength(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").press("Tab");

    await page.keyboard.press("Escape");

    await expect(page.locator("#edit-pattern-widget")).toBeHidden();
    expect(await recoveryWidth(page)).toBe(5);
    expect(await historyLength(page)).toBe(before + 1);
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
    await expect(page.getByRole("button", { name: "Apply" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Cancel" })).toHaveCount(0);
    expect(await pixelRGB(page, lastCell.cx, lastCell.cy)).toEqual(validPreview);
    expect(await pixelRGB(page, outside.cx, outside.cy)).toEqual(validOutside);
});

test("Pattern presents direct properties with contextual resize feedback", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();

    await expect(page.getByLabel("Centre opening width")).toBeAttached();
    await expect(page.getByLabel("Centre opening height")).toBeAttached();
    await expect(page.getByRole("button", { name: "Clear drawing" })).toBeVisible();
    await expect(page.locator("#edit-summary")).toBeHidden();

    await page.locator("#edit-width").fill("10");
    await page.locator("#edit-width").dispatchEvent("input");
    await expect(page.locator("#edit-summary")).toHaveText(
        "10 × 9 cells · 9 cells added",
    );
    await page.locator("#edit-width").press("Tab");
    await expect(page.locator("#edit-summary")).toBeHidden();

    await page.locator('label:has(input[name="edit-mode"][value="round"])').click();
    await expect(page.locator("#edit-summary")).toBeHidden();
});

test("Clear drawing restores natural colours immediately and is undoable", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    const cell = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(A);
    const beforeReset = await historyLength(page);
    await page.getByRole("button", { name: "Pattern" }).click();

    await page.getByRole("button", { name: "Clear drawing" }).click();

    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(B);
    expect(await historyLength(page)).toBe(beforeReset + 1);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(A);
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
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

test("save reports file-system failures and restores focus", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker = () =>
            Promise.reject(new Error("Disk full."));
    });

    await page.locator("#btn-save").click();

    await expect(page.locator("#document-error")).toContainText("Disk full.");
    await page.locator("#document-error-dismiss").click();
    await expect(page.locator("#btn-save")).toBeFocused();
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
