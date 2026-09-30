import { test, expect, type Page } from "@playwright/test";
import { bootApp, clickCell } from "./_helpers";

async function recovery(page: Page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
}

test("Clear design on an empty default design leaves history unchanged", async ({ page }) => {
    await bootApp(page);
    const before = await recovery(page);
    const historyBefore = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    await page.getByRole("button", { name: "Pattern" }).click();

    await page.getByRole("button", { name: "Clear design" }).click();
    await page.getByRole("button", { name: "Clear design" }).click();

    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(historyBefore);
    expect(await recovery(page)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("Pattern edits before and after Clear design remain separate undo actions", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    const original = await recovery(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("7");
    await page.locator("#edit-width").press("Tab");
    const beforeClear = await recovery(page);
    await page.getByRole("button", { name: "Clear design" }).click();
    const cleared = await recovery(page);
    await page.locator("#edit-height").fill("6");
    await page.locator("#edit-height").press("Tab");

    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recovery(page)).toEqual(cleared);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recovery(page)).toEqual(beforeClear);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recovery(page)).toEqual(original);
});

test("Clear design removes drawing and transform context in one recoverable edit", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("8");
    await page.locator("#edit-width").press("Tab");
    for (const [id, color] of [["color-a", "#7b3b27"], ["color-b", "#e8dbcd"],
        ["danger-color", "#c21833"], ["accent-color", "#125ad9"]]) {
        await page.locator(`#${id}`).evaluate((input: HTMLInputElement, value) => {
            input.value = value;
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        }, color);
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#labels-on)").click();
    await page.keyboard.press("Escape");
    const natural = await recovery(page);
    await clickCell(page, 0, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 0, 1);
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "New selection" }).click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-down").fill("1");
    await page.locator("#recipe-down").press("Tab");
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await page.getByRole("button", { name: "Add vertical" }).click();
    await page.getByRole("button", { name: "Add horizontal" }).click();
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Navigate" }).click();
    const before = await recovery(page);
    const historyBefore = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    );
    const viewBefore = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
    const preferencesBefore = await page.evaluate(() => localStorage.getItem("mosaic-preferences"));
    expect(before.workspace.float).not.toBeNull();
    expect(before.workspace.recipes).toHaveLength(2);
    expect(before.workspace.axes).toHaveLength(2);

    await page.locator("#edit-reset").click();

    const cleared = await recovery(page);
    expect(cleared.document).toEqual({ ...before.document, pixels: natural.document.pixels });
    expect(cleared.workspace.float).toBeNull();
    expect(cleared.workspace.axes).toEqual([]);
    expect(cleared.workspace.recipes).toHaveLength(1);
    expect(cleared.workspace.recipes[0]).toMatchObject({
        source: { x: 0, y: 0, w: 0, h: 0, mask: [] },
        mode: "grid", left: 0, right: 0, up: 0, down: 0,
        rotationTurns: [], mirrorHorizontal: false, mirrorVertical: false,
    });
    expect(cleared.workspace.activeRecipeId).toBe(cleared.workspace.recipes[0].id);
    expect(cleared.workspace.activeTool).toBe(before.workspace.activeTool);
    expect(cleared.workspace.primaryColor).toBe(before.workspace.primaryColor);
    expect(cleared.workspace.rotation).toBe(before.workspace.rotation);
    expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(viewBefore);
    expect(await page.evaluate(() => localStorage.getItem("mosaic-preferences"))).toBe(preferencesBefore);
    await expect(page.getByRole("button", { name: "Navigate" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Clear design" }))
        .toHaveAttribute("title", "Clear drawing, selections, repeats, and mirror axes");
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    )).toBe(historyBefore + 1);

    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recovery(page)).toEqual(before);
    await page.getByRole("button", { name: "Redo" }).click();
    expect(await recovery(page)).toEqual(cleared);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Selection 1 · Empty" })).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    expect(await recovery(page)).toEqual(cleared);
});

test("Clear design preserves authored centre-out geometry and compatible Crochet progress", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Half", { exact: true }).click();
    await page.keyboard.press("Escape");
    const natural = await recovery(page);
    await clickCell(page, 0, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 0, 1);
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "Begin Crocheting" }).click();
    await page.locator(".instructions-unit").nth(2).click();
    const progress = await page.evaluate(() => localStorage.getItem("mosaic-live-progress"));
    expect(JSON.parse(progress!).completedUnits).toBeGreaterThan(0);
    await page.getByRole("button", { name: "Back to Design" }).click();
    await page.getByRole("button", { name: "Pattern" }).click();

    await page.locator("#edit-reset").click();

    const cleared = await recovery(page);
    expect(cleared.document).toEqual(natural.document);
    expect(cleared.workspace.float).toBeNull();
    expect(cleared.workspace.recipes[0].source.mask).toEqual([]);
    expect(await page.evaluate(() => localStorage.getItem("mosaic-live-progress"))).toBe(progress);
    await page.locator("#btn-export").click();
    await expect(page.locator(".instructions-unit").nth(2)).toHaveAttribute("aria-current", "step");
});

test("Clear design records saved-repeat changes even with a natural chart and no live selection", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "Deselect", exact: true }).click();
    const before = await recovery(page);
    expect(before.workspace.float).toBeNull();
    await page.getByRole("button", { name: "Pattern" }).click();

    await page.locator("#edit-reset").click();

    expect((await recovery(page)).workspace.recipes[0].source.mask).toEqual([]);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await recovery(page)).toEqual(before);
});

test("Pattern previews after Clear design preserve the cleared source and revert invalid changes", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 0, 1);
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-reset").click();
    const cleared = await recovery(page);

    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("9");
    await page.locator("#edit-width").press("Tab");
    expect(await recovery(page)).toEqual(cleared);
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("2000000");
    await expect(page.locator("#edit-error")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await expect(page.getByRole("button", { name: "Selection 1 · Empty" })).toBeVisible();
    expect(await recovery(page)).toEqual(cleared);
});
