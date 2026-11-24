import { test, expect } from "@playwright/test";
import { addGlobalMirror, bootApp, clickCell, storedHistory, storedHistoryLength, storedLiveProgress, storedRecovery } from "./_helpers";

test("Clear design on an empty default design leaves history unchanged", async ({ page }) => {
    await bootApp(page);
    const before = await storedRecovery(page);
    const historyBefore = await storedHistory(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();

    await expect(page.getByRole("button", { name: "Clear design" })).toBeDisabled();

    expect(await storedHistory(page)).toEqual(historyBefore);
    expect(await storedRecovery(page)).toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeDisabled();
});

test("Pattern edits before and after Clear design remain separate undo actions", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    const original = await storedRecovery(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#edit-width").fill("7");
    await page.locator("#edit-width").press("Tab");
    const beforeClear = await storedRecovery(page);
    await page.getByRole("button", { name: "Clear design" }).click();
    const cleared = await storedRecovery(page);
    await page.locator("#edit-height").fill("6");
    await page.locator("#edit-height").press("Tab");

    await page.getByRole("button", { name: "Undo" }).click();
    expect(await storedRecovery(page)).toEqual(cleared);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await storedRecovery(page)).toEqual(beforeClear);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await storedRecovery(page)).toEqual(original);
});

test("Clear design removes drawing and transform context in one recoverable edit", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
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
    const natural = await storedRecovery(page);
    await clickCell(page, 0, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 0, 1);
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "No selection" }).click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-down").fill("1");
    await page.locator("#recipe-down").press("Tab");
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: /Pattern Mirror/ }).click();
    await addGlobalMirror(page, "Vertical");
    await addGlobalMirror(page, "Horizontal");
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Navigate" }).click();
    const before = await storedRecovery(page);
    const historyBefore = await storedHistoryLength(page);
    const viewBefore = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
    const preferencesBefore = await page.evaluate(() => localStorage.getItem("mosaic-preferences"));
    expect(before.workspace.float).not.toBeNull();
    expect(before.workspace.recipes).toHaveLength(2);
    expect(before.workspace.mirrors).toHaveLength(2);

    await page.locator("#edit-reset").click();

    const cleared = await storedRecovery(page);
    expect(cleared.document).toEqual({ ...before.document, pixels: natural.document.pixels });
    expect(cleared.workspace.float).toBeNull();
    expect(cleared.workspace.mirrors).toEqual([]);
    expect(cleared.workspace.recipes).toHaveLength(1);
    expect(cleared.workspace.recipes[0]).toMatchObject({
        source: { x: 0, y: 0, w: 0, h: 0, mask: "" },
        mode: "grid", left: 0, right: 0, up: 0, down: 0,
        rotationTurns: [], mirrorTypes: [],
    });
    expect(cleared.workspace.activeRecipeId).toBeNull();
    expect(cleared.workspace.activeTool).toBe(before.workspace.activeTool);
    expect(cleared.workspace.primaryColor).toBe(before.workspace.primaryColor);
    expect(cleared.workspace.rotation).toBe(before.workspace.rotation);
    expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(viewBefore);
    expect(await page.evaluate(() => localStorage.getItem("mosaic-preferences"))).toBe(preferencesBefore);
    await expect(page.getByRole("button", { name: "Navigate" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Clear design" }))
        .toHaveAttribute("title", "Clear drawing, selections, repeats, and mirrors");
    expect(await storedHistoryLength(page)).toBe(historyBefore + 1);

    await page.getByRole("button", { name: "Undo" }).click();
    expect(await storedRecovery(page)).toEqual(before);
    await page.getByRole("button", { name: "Redo" }).click();
    expect(await storedRecovery(page)).toEqual(cleared);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
    await expect(page.getByRole("button", { name: "No selection", exact: true })).toBeVisible();

    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    expect(await storedRecovery(page)).toEqual({ ...cleared, workspace: { ...cleared.workspace, activeTool: "select" } });
});

test("Clear design preserves authored centre-out geometry and compatible Crochet progress", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Half", { exact: true }).click();
    await page.keyboard.press("Escape");
    const natural = await storedRecovery(page);
    await page.getByRole("button", { name: "Invert", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("tab", { name: "Crochet", exact: true }).click();
    await page.locator(".instructions-unit").nth(2).click();
    const progress = await storedLiveProgress(page);
    expect(progress.completedUnits).toBeGreaterThan(0);
    await page.getByRole("tab", { name: "Design", exact: true }).click();
    await page.getByRole("button", { name: "Pattern", exact: true }).click();

    await page.locator("#edit-reset").click();

    const cleared = await storedRecovery(page);
    expect(cleared.document).toEqual(natural.document);
    expect(cleared.workspace.float).toBeNull();
    expect(cleared.workspace.recipes[0].source.mask).toBe("");
    expect(await storedLiveProgress(page)).toEqual(progress);
    await page.locator("#view-crochet").click();
    await expect(page.locator(".instructions-unit").nth(2)).toHaveAttribute("aria-current", "step");
});

test("Clear design stays disabled with saved repeats and a natural chart", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "No selection", exact: true }).click();
    const before = await storedRecovery(page);
    expect(before.workspace.float).toBeNull();
    await page.getByRole("button", { name: "Pattern", exact: true }).click();

    await expect(page.locator("#edit-reset")).toBeDisabled();
    expect(await storedRecovery(page)).toEqual(before);
});

test("Pattern previews after Clear design preserve the cleared source and revert invalid changes", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 0, 1);
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Tab");
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#edit-reset").click();
    const cleared = await storedRecovery(page);

    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("9");
    await page.locator("#edit-width").press("Tab");
    expect(await storedRecovery(page)).toEqual(cleared);
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("2000000");
    await expect(page.locator("#edit-error")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByRole("button", { name: "No selection", exact: true })).toBeVisible();
    expect(await storedRecovery(page)).toEqual(cleared);
});
