import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

test("Select and Wand reopen the inspector with accessible saved selection rows", async ({ page }) => {
    await bootApp(page);
    await expect(page.locator("#selection-actions")).toHaveCount(0);
    const select = page.getByRole("button", { name: "Select", exact: true });
    await select.click();
    await expect(select).toHaveAttribute("aria-expanded", "true");
    const list = page.getByRole("list", { name: "Selections" });
    await expect(list.getByRole("listitem")).toHaveCount(1);
    await expect(list.getByRole("button", { name: "Selection 1 Empty" })).toHaveAttribute("aria-pressed", "true");
    await clickCell(page, 2, 1);
    await page.locator("#recipe-create").click();
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
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-create").click();
    await page.getByRole("button", { name: "Delete selection 2" }).focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Delete selection 2" })).toBeFocused();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Selection 1 Empty" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Delete selection 1" })).toBeDisabled();
});
