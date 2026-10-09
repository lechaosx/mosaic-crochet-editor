import { test, expect } from "@playwright/test";
import { addGlobalMirror, bootApp, cellCoord, pixelRGB, touchDragCells, touchPanZoom } from "./_helpers";

for (const [tool, family] of [["select", "Rectangle"], ["wand", "Wand"], ["move", "Move"], ["overlay", "Overlay"]]) {
    test(`two taps at the same ${family} button open its menu`, async ({ page }) => {
        await page.setViewportSize({ width: 390, height: 844 });
        await bootApp(page);
        const button = page.locator(`#tool-${tool}`);
        const bounds = (await button.boundingBox())!;
        const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
        await page.touchscreen.tap(x, y);
        await expect(button).toHaveAttribute("aria-pressed", "true");
        await expect(page.getByRole("menu", { name: `${family} variants`, exact: true })).toBeHidden();
        if (tool === "select" || tool === "wand") await expect(page.locator("#selection-popover")).toBeVisible();
        await page.touchscreen.tap(x, y);
        await expect(page.getByRole("menu", { name: `${family} variants`, exact: true })).toBeVisible();
        await expect(button).toHaveAttribute("aria-expanded", "true");
    });
}

test("touch menus work when the browser reports each tap as a single click", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => document.addEventListener("click", event => {
        if ((event.target as Element).closest("#tool-move")) Object.defineProperty(event, "detail", { value: 1 });
    }, true));
    const button = page.locator("#tool-move");
    const bounds = (await button.boundingBox())!;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.touchscreen.tap(x, y);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("menu", { name: "Move variants", exact: true })).toBeVisible();
});

for (const cancellation of ["scroll", "blur", "pointercancel"] as const) test(
    `a ${cancellation} ends the touch double-press sequence`, async ({ page }) => {
    await bootApp(page);
    const button = page.locator("#tool-move");
    const bounds = (await button.boundingBox())!;
    const x = bounds.x + bounds.width / 2, y = bounds.y + bounds.height / 2;
    await page.touchscreen.tap(x, y);
    await page.evaluate(event => {
        if (event === "pointercancel") document.getElementById("tool-move")!
            .dispatchEvent(new PointerEvent(event, { pointerId: 99 }));
        else window.dispatchEvent(new Event(event));
    }, cancellation);
    await page.touchscreen.tap(x, y);
    await expect(page.getByRole("menu", { name: "Move variants", exact: true })).toBeHidden();
    await expect(button).toHaveAttribute("aria-pressed", "true");
});

test("a rotated mirror centre supports touch drag and system cancellation without changing canvas pixels", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").tap();
    await addGlobalMirror(page, "Point reflection (180°)");
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);
    await page.getByRole("button", { name: "Rotate view right", exact: true }).tap();
    await page.waitForTimeout(350);
    await touchDragCells(page, 4, 4, 3, 2);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 3, y: 2 });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(before);
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    const start = await cellCoord(page, 3, 2), end = await cellCoord(page, 2, 3);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.cx, y: start.cy, id: 0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchMove", touchPoints: [{ x: end.cx, y: end.cy, id: 0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchCancel", touchPoints: [] });
    await session.detach();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 3, y: 2 });
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
});

test("single-finger drag paints", async ({ page }) => {
    await bootApp(page);
    const start = await cellCoord(page, 1, 1), end = await cellCoord(page, 3, 1);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.cx, y: start.cy, id: 0 }] });
    for (let step = 1; step <= 10; step++) await session.send("Input.dispatchTouchEvent", {
        type: "touchMove", touchPoints: [{ x: start.cx + (end.cx - start.cx) * step / 10, y: start.cy, id: 0 }],
    });
    await expect(page.locator("#status-action")).toBeVisible();
    await expect(page.locator("#status-action")).toHaveText("Pencil · Yarn A");
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
    await expect(page.locator("#status-action")).toBeHidden();

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
    await page.locator("#tool-move").tap();
    await page.locator("#tool-move").tap();
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
    await expect(card.getByRole("button", { name: "No selection" })).toBeVisible();

    await card.getByRole("button", { name: "Copy" }).tap();
    await expect(card.getByRole("button", { name: "Paste" })).toBeEnabled();
    await page.getByRole("button", { name: "Close inspector" }).tap();
    await page.getByRole("button", { name: "Move", exact: true }).tap();
    await page.locator("#tool-move").tap();
    await page.locator("#tool-move").tap();
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
    await expect(card.locator("#selection-card-title")).toHaveText("Clipboard");
    await expect(clipboardSummary).toHaveText("1 copied");
    await card.getByRole("button", { name: "Paste" }).click();
    await expect(page.locator("#status-selection")).toHaveText("1 selected");
    await page.getByRole("button", { name: "Close inspector" }).click();
    await summary.click();
    await card.getByRole("button", { name: "No selection" }).click();
    await page.getByRole("button", { name: "Close inspector" }).click();
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
