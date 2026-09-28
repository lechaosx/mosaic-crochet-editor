import { expect, test } from "@playwright/test";
import { bootApp, clickCell } from "./_helpers";

test("selection tools open and reopen the Selection inspector", async ({ page }) => {
    await bootApp(page);

    const select = page.getByRole("button", { name: "Select", exact: true });
    await select.click();
    await expect(page.locator("#inspector-title")).toHaveText("Selection");
    await expect(page.getByRole("group", { name: "Selection mode" })).toBeVisible();

    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(page.locator("#inspector-host")).toBeHidden();
    await select.click();
    await expect(page.locator("#selection-popover")).toBeVisible();

    await page.getByRole("button", { name: "Close inspector" }).click();
    const wand = page.getByRole("button", { name: "Magic wand" });
    await wand.click();
    await expect(page.locator("#selection-popover")).toBeVisible();
    await page.getByRole("button", { name: "Close inspector" }).click();
    await wand.click();
    await expect(page.locator("#selection-popover")).toBeVisible();
});

test("Move opens a separate inspector and reopens it after dismissal", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 2, 2);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 2);

    const move = page.getByRole("button", { name: "Move", exact: true });
    await move.click();
    await expect(page.locator("#inspector-title")).toHaveText("Move");
    await expect(page.locator("#move-popover")).toBeVisible();
    await expect(page.locator("#selection-popover")).toBeHidden();
    await expect(page.getByRole("button", { name: "Move content" })).toBeVisible();
    await expect(page.locator("#move-popover").getByRole("button", { name: /Duplicate/ })).toBeVisible();
    await expect(page.locator("#move-popover").getByRole("button", { name: /Move area/ })).toBeVisible();

    await page.getByRole("button", { name: "Close inspector" }).click();
    await move.click();
    await expect(page.locator("#move-popover")).toBeVisible();
});

test("overlay tools are icon-only buttons with accessible names", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);

    for (const [name, symbol] of [
        ["Place overlay", "#icon-overlay-place"],
        ["Clear overlay", "#icon-overlay-clear"],
        ["Invert overlay", "#icon-overlay-invert"],
    ] as const) {
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveClass(/btn--icon/);
        await expect(button).toHaveText("");
        await expect(button.locator("use")).toHaveAttribute("href", symbol);
        expect(await button.evaluate(element => getComputedStyle(element, "::before").content)).toBe("none");
    }
});

test("live repeat and mirror controls are always on", async ({ page }) => {
    await bootApp(page);

    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await expect(page.locator("#live-transforms")).toHaveCount(0);
    await expect(page.getByText("Mirror while drawing", { exact: true })).toHaveCount(0);

    await page.getByRole("button", { name: "Close inspector" }).click();
    await clickCell(page, 2, 2);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 2);
    await page.locator("#recipe-create").click();
    await expect(page.locator("#recipe-enabled")).toHaveCount(0);
    await expect(page.getByText("Repeat while drawing", { exact: true })).toHaveCount(0);
});
