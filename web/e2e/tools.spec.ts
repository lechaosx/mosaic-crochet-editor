// Tool selection: keyboard shortcuts and toolbar buttons activate the
// right tool. The "active" state is reflected by the `btn--active` class
// on the corresponding toolbar button.
import { test, expect } from "@playwright/test";
import { bootApp } from "./_helpers";

const TOOLS: [string, string][] = [
    ["P", "tool-pencil"],
    ["F", "tool-fill"],
    ["E", "tool-eraser"],
    ["O", "tool-overlay"],
    ["I", "tool-invert"],
    ["S", "tool-select"],
    ["W", "tool-wand"],
    ["M", "tool-move"],
];

test.describe("keyboard tool shortcuts", () => {
    for (const [key, id] of TOOLS) {
        test(`${key} activates #${id}`, async ({ page }) => {
            await bootApp(page);
            await page.keyboard.press(key.toLowerCase());
            await expect(page.locator(`#${id}`)).toHaveClass(/btn--active/);
        });
    }
});

test.describe("toolbar buttons", () => {
    for (const [, id] of TOOLS) {
        test(`clicking #${id} activates it`, async ({ page }) => {
            await bootApp(page);
            await page.locator(`#${id}`).click();
            await expect(page.locator(`#${id}`)).toHaveClass(/btn--active/);
        });
    }
});

test("Alt held swaps to Move, release restores prior tool", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await expect(page.locator("#tool-pencil")).toHaveClass(/btn--active/);
    await page.keyboard.down("Alt");
    await expect(page.locator("#tool-move")).toHaveClass(/btn--active/);
    await page.keyboard.up("Alt");
    await expect(page.locator("#tool-pencil")).toHaveClass(/btn--active/);
});
