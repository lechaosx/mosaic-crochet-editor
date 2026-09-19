import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

test("canvas arrows inspect one logical cell and Space applies Pencil", async ({ page }) => {
    await bootApp(page);
    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    await canvas.focus();
    await expect(canvas).toBeFocused();
    await expect(page.getByRole("status", { name: "Keyboard cell" }))
        .toContainText("Cell 4, 4 · Yarn A");

    await page.keyboard.press("ArrowUp");
    await expect(page.locator("#status-coordinates")).toHaveText("4, 3");
    await expect(page.getByRole("status", { name: "Keyboard cell" }))
        .toContainText("Cell 4, 3 · Yarn B · overlay placement available");

    const cell = await cellCoord(page, 4, 3);
    const before = await pixelRGB(page, cell.cx, cell.cy);
    await page.keyboard.press("Space");
    expect(await pixelRGB(page, cell.cx, cell.cy)).not.toEqual(before);
    await expect(page.getByRole("button", { name: "Undo" })).toBeEnabled();
});

test("keyboard cursor can inspect a centre-out hole", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator('label:has(input[name="edit-mode"][value="round"])').click();
    await page.keyboard.press("Escape");

    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    await canvas.focus();
    await expect(page.getByRole("status", { name: "Keyboard cell" }))
        .toContainText("outside pattern");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await expect(page.getByRole("status", { name: "Keyboard cell" }))
        .toContainText(/Cell 8, 6 · Yarn [AB]/);
});

test("arrows inspect with Select but nudge selected content with Move", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await expect(page.locator("#status-coordinates")).toHaveText("2, 1");
    await page.keyboard.press("Escape");
    const source = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([0, 0, 0]);

    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    await canvas.focus();
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("Escape");
    const destination = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([0, 0, 0]);
});

test("Space applies Select and reports a protected Pencil edit", async ({ page }) => {
    await bootApp(page);
    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    await canvas.focus();
    await page.keyboard.press("s");
    await page.keyboard.press("Space");
    await expect(page.getByRole("button", { name: "1 selected" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("ArrowUp");
    await page.keyboard.press("p");
    await page.keyboard.press("2");
    await page.keyboard.press("Space");
    await expect(page.locator("#status-feedback")).toContainText("Protected cell skipped");
});

test("keyboard paint keeps allowed transform destinations when another is protected", async ({ page }) => {
    await bootApp(page);
    const canvas = page.getByRole("img", { name: "Editable pattern chart" });
    await canvas.focus();
    for (let i = 0; i < 4; i++) await page.keyboard.press("ArrowUp");
    await page.keyboard.press("h");
    await page.keyboard.press("2");
    await page.keyboard.press("Space");
    await expect(page.locator("#status-feedback")).toContainText("Protected cell skipped");
    const allowed = await cellCoord(page, 4, 8);
    expect(await pixelRGB(page, allowed.cx, allowed.cy)).toEqual([255, 255, 255]);
});
