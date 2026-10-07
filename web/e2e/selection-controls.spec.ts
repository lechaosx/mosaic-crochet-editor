import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

test("Select and Wand reopen the inspector with accessible saved selection rows", async ({ page }) => {
    await bootApp(page);
    await expect(page.locator("#selection-actions")).toHaveCount(0);
    const select = page.getByRole("button", { name: "Select", exact: true });
    await select.click();
    await expect(page.locator("#selection-popover")).toBeVisible();
    await expect(select).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("menu", { name: "Rectangle variants", exact: true })).toBeHidden();
    const list = page.getByRole("list", { name: "Selections" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("button", { name: "No selection", exact: true })).toHaveAttribute("aria-pressed", "true");
    await clickCell(page, 2, 1);
    await expect(list.getByRole("listitem")).toHaveCount(2);
    const saved = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes);
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-create").click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes)).toEqual(saved);
    await expect(list.getByRole("listitem")).toHaveCount(2);
    const first = list.getByRole("button", { name: "Selection 1 1 × 1" });
    await first.focus();
    await page.keyboard.press("Enter");
    await expect(list.getByRole("button", { name: "Selection 1 1 × 1" })).toHaveAttribute("aria-pressed", "true");
    await expect(list.getByRole("button", { name: "Selection 1 1 × 1" })).toBeFocused();
    await page.locator("#inspector-close").click();
    await expect(select).toBeFocused();
    await expect(select).toHaveAttribute("aria-expanded", "false");
    await select.click();
    await expect(page.locator("#selection-popover")).toBeVisible();
    await page.locator("#inspector-close").click();
    const wand = page.getByRole("button", { name: "Magic wand", exact: true });
    await wand.click();
    await expect(page.locator("#selection-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(wand).toBeFocused();
    await page.keyboard.press("w");
    await expect(page.locator("#selection-popover")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeVisible();
});

test("four grid mirror toggles compose for Apply and live drawing", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await dragCells(page, 1, 1, 2, 2);
    for (const id of ["recipe-right", "recipe-down"]) {
        await page.locator(`#${id}`).fill("1");
        await page.locator(`#${id}`).dispatchEvent("change");
    }
    for (const axis of ["column", "row"]) {
        for (const mirror of ["horizontal", "vertical"]) {
            await page.locator(`#recipe-${axis}-mirror-${mirror}`).check();
        }
    }
    await page.locator("#recipe-apply").click();
    for (const [x, y] of [[1, 1], [4, 2], [2, 4], [3, 3]]) {
        const cell = await cellCoord(page, x, y);
        expect(await pixelRGB(page, cell.cx, cell.cy), `${x},${y}`).toEqual([0, 0, 0]);
    }
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await page.getByRole("button", { name: "Pencil", exact: true }).click();
    await clickCell(page, 3, 3);
    for (const [x, y] of [[1, 1], [4, 2], [2, 4], [3, 3]]) {
        const cell = await cellCoord(page, x, y);
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([255, 255, 255]);
    }
    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (const axis of ["column", "row"]) {
        for (const mirror of ["horizontal", "vertical"]) {
            await expect(page.locator(`#recipe-${axis}-mirror-${mirror}`)).toBeChecked();
        }
    }
});


test("keyboard deletion moves focus to a surviving saved selection", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.locator("#recipe-create").click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-create").click();
    await clickCell(page, 3, 1);
    await page.getByRole("button", { name: "Delete selection 2" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Delete selection 2" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Delete selection 1" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "No selection", exact: true })).toBeFocused();
});

test("Pattern shape changes prune vanished selections and mirrors, and Undo restores them", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 7, 1);
    await page.locator("#recipe-create").click();
    await clickCell(page, 1, 1);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#add-mirror").click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true }).click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#edit-width").fill("4");
    await page.locator("#edit-width").press("Tab");
    await page.keyboard.press("Escape");
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace);
    expect(after.recipes).toHaveLength(1);
    expect(after.recipes[0].id).toBe(before.recipes[1].id);
    expect(after.recipes[0].source).toMatchObject({ x: 1, y: 1, w: 1, h: 1 });
    expect(after.mirrors).toEqual([]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const restored = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace);
    expect(restored.recipes).toEqual(before.recipes);
    expect(restored.mirrors).toEqual(before.mirrors);
    expect(restored.float).toEqual(before.float);
});

test("new selection placeholder survives recovery without replacing an earlier source", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.locator("#recipe-create").click();
    await page.reload(); await page.waitForFunction(() => !!window.__test_matrix__);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.locator("#recipe-create")).toHaveAttribute("aria-pressed", "true");
    await clickCell(page, 3, 1);
    const sources = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes.map((recipe: { source: unknown }) => recipe.source));
    expect(sources).toHaveLength(2);
    expect(sources[0]).toMatchObject({ x: 1, y: 1, w: 1, h: 1 });
    expect(sources[1]).toMatchObject({ x: 3, y: 1, w: 1, h: 1 });
});

test("Paste instantiates the new selection placeholder without overwriting saved selections", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0]);
    await page.locator("#recipe-create").click();
    await page.getByRole("button", { name: "Paste", exact: true }).click();
    const recipes = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes);
    expect(recipes).toHaveLength(2);
    expect(recipes[0]).toEqual(before);
    expect(recipes[1].source).toEqual(before.source);
    await expect(page.locator("#recipe-create")).toHaveAttribute("aria-pressed", "false");
});

for (const record of ["recipes", "mirrors"] as const) {
    test(`Open preserves a valid ${record} record whose id is new`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await clickCell(page, 1, 1);
        await page.locator("#btn-sym-toggle").click();
        await page.locator("#add-mirror").click();
        await page.evaluate(() => {
            const target = window as unknown as { savedMcw?: string; showSaveFilePicker?: () => Promise<unknown> };
            target.showSaveFilePicker = async () => ({ createWritable: async () => ({
                write: async (source: string) => { target.savedMcw = source; }, close: async () => {},
            }) });
        });
        await page.locator("#btn-save").click();
        await expect.poll(() => page.evaluate(() => (window as unknown as { savedMcw?: string }).savedMcw)).toBeTruthy();
        const file = JSON.parse(await page.evaluate(() => (window as unknown as { savedMcw: string }).savedMcw));
        file[record][0].id = "new";
        const errors: string[] = []; page.on("pageerror", error => errors.push(error.message));
        const chooser = page.waitForEvent("filechooser"); await page.locator("#btn-load").click();
        await (await chooser).setFiles({ name: "saved-id-new.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
        await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace[key][0].id, record)).toBe("new");
        if (record === "recipes") {
            await page.getByRole("button", { name: "Select", exact: true }).click();
            await page.getByRole("button", { name: "Selection 1 1 × 1" }).click();
            await expect(page.locator("#recipe-create")).toBeVisible();
        } else {
            await page.getByRole("button", { name: "Select Mirror 1 at (4, 4)", exact: true }).click();
            await expect(page.locator("#add-mirror")).toBeVisible();
        }
        expect(errors).toEqual([]);
    });
}

test("round resizing disables unsafe copies and preserves the editable source after recovery", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    for (const [id, value] of [["edit-inner-width", "4"], ["edit-inner-height", "4"], ["edit-rounds", "2"]]) {
        await page.locator(`#${id}`).fill(value); await page.locator(`#${id}`).press("Tab");
    }
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await dragCells(page, 0, 0, 6, 2);
    await page.locator('label:has(#recipe-mode-circle)').click();
    await page.locator("#recipe-centre-x").fill("2");
    await page.locator("#recipe-centre-y").fill("2");
    await page.locator("#recipe-centre-y").press("Enter");
    await page.locator("#recipe-turn-180").check();
    const old = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0]);
    expect(old).toMatchObject({ mode: "circle", rotationTurns: [180] });
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#edit-inner-width").fill("2"); await page.locator("#edit-inner-width").press("Tab");
    await page.keyboard.press("Escape");
    const updated = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0]);
    expect(updated).toMatchObject({ id: old.id, mode: "none", rotationTurns: [180], source: { x: 0, y: 0, w: 5, h: 3 } });
    await page.reload(); await page.waitForFunction(() => !!window.__test_matrix__);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Selection 1 5 × 3" }).click();
    await expect(page.locator("#recipe-mode-none")).toBeChecked();
    await expect(page.locator("#recipe-error")).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy", exact: true })).toBeEnabled();
});
