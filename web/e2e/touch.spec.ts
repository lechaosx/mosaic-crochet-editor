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

test("selection and clipboard lifecycle is available without keyboard modifiers", async ({ page }) => {
    await bootApp(page);
    const painted = await cellCoord(page, 1, 1);
    await page.touchscreen.tap(painted.cx, painted.cy);
    await page.getByRole("button", { name: "Select" }).tap();
    await page.touchscreen.tap(painted.cx, painted.cy);

    const summary = page.getByRole("button", { name: "1 selected" });
    await expect(summary).toBeVisible();
    await summary.tap();

    const card = page.getByRole("dialog", { name: "Selection" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Move content" })).toHaveAttribute("aria-pressed", "true");
    await expect(card.getByRole("button", { name: "Duplicate content" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Move selection area" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Cut" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Paste" })).toBeDisabled();
    await expect(card.getByRole("button", { name: "Deselect" })).toBeVisible();

    await card.getByRole("button", { name: "Copy" }).tap();
    await expect(card.getByRole("button", { name: "Paste" })).toBeEnabled();
    await card.getByRole("button", { name: "Duplicate content" }).tap();
    await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(card).toBeHidden();

    await touchDragCells(page, 1, 1, 3, 1);
    const source = await cellCoord(page, 1, 1);
    const destination = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([0, 0, 0]);
    await summary.click();
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Duplicate content" })).toHaveAttribute("aria-pressed", "true");

    await card.getByRole("button", { name: "Cut" }).tap();
    const clipboardSummary = page.getByRole("button", { name: "Clipboard, 1 cell" });
    await expect(clipboardSummary).toBeVisible();
    const hovered = await cellCoord(page, 2, 1);
    await page.mouse.move(hovered.cx, hovered.cy);
    await expect(clipboardSummary).toBeVisible();
    await card.getByRole("button", { name: "Paste" }).tap();
    await expect(page.getByRole("button", { name: "1 selected" })).toBeVisible();
    await card.getByRole("button", { name: "Deselect" }).tap();
    await expect(summary).toBeHidden();
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([0, 0, 0]);
});

test("Yarn A and B plus Edit and Swap remain directly available on phone", async ({ page }) => {
    await bootApp(page);
    await expect(page.getByRole("button", { name: "Yarn A", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yarn B", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Edit Yarn A" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Swap yarns" })).toBeVisible();
    expect(await page.locator("#toolbar").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
