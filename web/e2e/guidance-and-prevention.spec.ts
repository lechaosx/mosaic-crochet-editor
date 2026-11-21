import { test, expect, type Page } from "@playwright/test";
import { addGlobalMirror, bootApp, cellCoord, clickCell, dragCells, pixelRGB, storedHistoryLength, storedRecovery } from "./_helpers";

test("guidance opacity changes chart markers without changing placement rules", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("o");
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");

    await page.getByRole("button", { name: "Settings" }).click();
    const target = await cellCoord(page, 2, 1);
    const shown = await pixelRGB(page, target.cx, target.cy);
    const guidance = page.getByRole("slider", { name: "Guidance opacity" });
    const prevention = page.getByRole("checkbox", { name: "Prevent impossible overlay placements" });
    await expect(guidance).toHaveValue("100");
    await expect(prevention).toBeChecked();
    await guidance.fill("0");
    await expect(guidance).toHaveValue("0");
    await expect(prevention).toBeChecked();
    const hidden = await pixelRGB(page, target.cx, target.cy);
    expect(hidden).not.toEqual(shown);
    await guidance.fill("100");
    await expect(guidance).toHaveValue("100");
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual(shown);
});

test("prevention blocks a new impossible mark but allows its correction", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const prevention = page.getByRole("checkbox", { name: "Prevent impossible overlay placements" });
    const preventionLabel = page.locator("label:has(#lock-invalid)");
    await expect(prevention).toBeChecked();
    await page.keyboard.press("Escape");
    const before = (await storedRecovery(page)).document.pixels;

    await clickCell(page, 1, 0, { button: "right" });
    await expect(page.locator("#status-feedback")).toContainText("Protected");
    expect((await storedRecovery(page)).document.pixels).toBe(before);

    await page.getByRole("button", { name: "Settings" }).click();
    await preventionLabel.click();
    await expect(prevention).not.toBeChecked();
    await page.keyboard.press("Escape");
    await clickCell(page, 1, 0, { button: "right" });
    const wrong = (await storedRecovery(page)).document.pixels;
    expect(wrong).not.toBe(before);

    await page.getByRole("button", { name: "Settings" }).click();
    await preventionLabel.click();
    await expect(prevention).toBeChecked();
    await page.keyboard.press("Escape");
    await clickCell(page, 1, 0);
    expect((await storedRecovery(page)).document.pixels).toBe(before);
});

test("prevention keeps local Stamp copies off impossible cells", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);
    await page.locator("#recipe-up").fill("1");
    await page.locator("#recipe-up").press("Enter");
    const before = (await storedRecovery(page)).document.pixels;
    const snapshots = await storedHistoryLength(page);

    await page.locator("#recipe-apply").click();
    expect((await storedRecovery(page)).document.pixels).toBe(before);
    expect(await storedHistoryLength(page)).toBe(snapshots);
    await expect(page.locator("#status-feedback")).toContainText("Protected");

    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.locator("#recipe-apply").click();
    expect((await storedRecovery(page)).document.pixels).not.toBe(before);
});

test("prevention keeps global mirror Stamp copies off impossible cells", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 8, { button: "right" });
    await page.keyboard.press("s");
    await clickCell(page, 2, 8);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Horizontal");
    const before = (await storedRecovery(page)).document.pixels;

    await page.locator("#replicate-selection").click();
    expect((await storedRecovery(page)).document.pixels).toBe(before);
    await expect(page.locator("#status-feedback")).toContainText("Protected");
});

test("prevention keeps a paste off impossible cells", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.keyboard.press("p");
    await clickCell(page, 1, 0, { button: "right" });
    await page.keyboard.press("s");
    await clickCell(page, 1, 0);
    await page.keyboard.press("Control+x");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    const before = (await storedRecovery(page)).document.pixels;

    await page.keyboard.press("Control+v");
    await expect(page.locator("#status-feedback")).toContainText("Protected");
    await page.keyboard.press("Control+Shift+A");
    expect((await storedRecovery(page)).document.pixels).toBe(before);
});

for (const [name, move] of [
    ["dragging", (page: Page) => dragCells(page, 2, 1, 2, 0)],
    ["an arrow key", (page: Page) => page.keyboard.press("ArrowUp")],
] as const) {
    test(`prevention keeps a selection moved by ${name} off impossible cells`, async ({ page }) => {
        await bootApp(page);
        const natural = (await storedRecovery(page)).document.pixels;
        await page.keyboard.press("s");
        await clickCell(page, 2, 1);
        await page.keyboard.press("m");

        await move(page);
        await expect(page.locator("#status-feedback")).toContainText("Protected");
        await page.keyboard.press("Control+Shift+A");
        expect((await storedRecovery(page)).document.pixels).toBe(natural);
    });
}
