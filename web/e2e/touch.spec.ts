import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, pixelRGB, touchDragCells, touchPanZoom } from "./_helpers";

test("single-finger drag paints", async ({ page }) => {
    await bootApp(page);
    await touchDragCells(page, 1, 1, 3, 1);
    await expect(page.locator("#status-action")).toBeVisible();
    await expect(page.locator("#status-action")).toHaveText("Pencil · Yarn A");

    for (let x = 1; x <= 3; x++) {
        const p = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, p.cx, p.cy)).toEqual([0, 0, 0]);
    }
});

test("touch hold opens variants without choosing a tool and scrolling cancels activation", async ({ page }) => {
    await bootApp(page);
    const button = page.locator("#tool-wand");
    const box = (await button.boundingBox())!;
    const point = { x: box.x + box.width / 2, y: box.y + box.height / 2, id: 0 };
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    const menu = page.getByRole("menu", { name: "Wand variants", exact: true });
    await expect(menu).toBeVisible();
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");

    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [point] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ ...point, y: point.y - 40 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await page.waitForTimeout(500);
    await expect(menu).toBeHidden();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await button.focus();
    await page.keyboard.press("Enter");
    await expect(button).toHaveAttribute("aria-pressed", "true");
    await session.detach();
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
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
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
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    )).toBe(1);
});

test("Move area mode supports a modifier-free touch drag", async ({ page }) => {
    await bootApp(page);
    const painted = await cellCoord(page, 1, 1);
    await page.touchscreen.tap(painted.cx, painted.cy);
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await page.getByRole("button", { name: "Close inspector" }).tap();
    await page.touchscreen.tap(painted.cx, painted.cy);
    await page.getByRole("button", { name: "Move", exact: true }).tap();
    await page.getByRole("button", { name: "Move variants", exact: true }).tap();
    await page.getByRole("menuitemradio", { name: "Move area", exact: true }).tap();

    await touchDragCells(page, 1, 1, 3, 1);

    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.float))
        .toMatchObject({ x: 3, y: 1, w: 1, h: 1 });
    const src = await cellCoord(page, 1, 1);
    const dst = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, src.cx, src.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, dst.cx, dst.cy)).not.toEqual([0, 0, 0]);
});

test("selection and clipboard lifecycle is available without keyboard modifiers", async ({ page }) => {
    await bootApp(page);
    const painted = await cellCoord(page, 1, 1);
    await page.touchscreen.tap(painted.cx, painted.cy);
    await page.getByRole("button", { name: "Select", exact: true }).tap();
    await page.getByRole("button", { name: "Close inspector" }).tap();
    await page.touchscreen.tap(painted.cx, painted.cy);

    const summary = page.getByRole("button", { name: "Select", exact: true });
    await expect(summary).toBeVisible();
    await summary.tap();

    const card = page.getByRole("dialog", { name: "Selection" });
    await expect(card).toBeVisible();
    await expect(card.getByRole("button", { name: "Move content" })).toHaveCount(0);
    await expect(card.getByRole("button", { name: "Copy" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Cut" })).toBeVisible();
    await expect(card.getByRole("button", { name: "Paste" })).toBeDisabled();
    await expect(card.getByRole("button", { name: "Deselect" })).toBeVisible();

    await card.getByRole("button", { name: "Copy" }).tap();
    await expect(card.getByRole("button", { name: "Paste" })).toBeEnabled();
    await page.getByRole("button", { name: "Close inspector" }).tap();
    await page.getByRole("button", { name: "Move", exact: true }).tap();
    await page.getByRole("button", { name: "Move variants", exact: true }).tap();
    const moveMenu = page.getByRole("menu", { name: "Move variants", exact: true });
    await moveMenu.getByRole("menuitemradio", { name: "Duplicate", exact: true }).tap();
    await expect(page.getByRole("button", { name: "Move", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#tool-move")).toHaveAccessibleDescription(/Duplicate/);
    await expect(moveMenu).toBeHidden();

    await touchDragCells(page, 1, 1, 3, 1);
    const source = await cellCoord(page, 1, 1);
    const destination = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([0, 0, 0]);
    await summary.click();
    await expect(card).toBeVisible();
    await page.getByRole("button", { name: "Close inspector" }).click();
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await expect(page.locator("#tool-move")).toHaveAccessibleDescription(/Duplicate/);
    await summary.click();

    await card.getByRole("button", { name: "Cut" }).click();
    const clipboardSummary = page.locator("#status-selection");
    await expect(clipboardSummary).toBeVisible();
    const hovered = await cellCoord(page, 2, 1);
    await page.mouse.move(hovered.cx, hovered.cy);
    await expect(clipboardSummary).toBeVisible();
    await card.getByRole("button", { name: "Paste" }).click();
    await expect(page.locator("#status-selection")).toHaveText("1 selected");
    await page.getByRole("button", { name: "Close inspector" }).click();
    await summary.click();
    await card.getByRole("button", { name: "Deselect" }).click();
    await expect(card).toBeHidden();
    await expect(clipboardSummary).toHaveText("1 copied");
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([0, 0, 0]);
});

test("Yarn selection stays direct while phone colour editing lives in Pattern", async ({ page }) => {
    await bootApp(page);
    await expect(page.getByRole("button", { name: "Yarn A", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Yarn B", exact: true })).toBeVisible();
    await expect(page.locator("#edit-yarn")).toHaveCount(0);
    await page.getByRole("button", { name: "Menu" }).click();
    await page.getByRole("menuitem", { name: "Pattern" }).click();
    await expect(page.getByRole("button", { name: "Swap yarn colours" })).toBeVisible();
    expect(await page.locator("#authoring-dock").evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);
});
