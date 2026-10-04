import { expect, test } from "@playwright/test";
import { bootApp, clickCell, chooseToolVariant } from "./_helpers";

test("selection tools open and reopen the Selection inspector", async ({ page }) => {
    await bootApp(page);

    const select = page.getByRole("button", { name: "Select", exact: true });
    await select.click();
    await expect(page.locator("#inspector-title")).toHaveText("Selection");
    await expect(page.getByRole("button", { name: "Rectangle variants", exact: true })).toBeVisible();
    await expect(page.getByRole("group", { name: "Selection mode" })).toHaveCount(0);

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

test("Move offers outcomes through its dock menu without a separate inspector", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 2, 2);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 2);

    const move = page.getByRole("button", { name: "Move", exact: true });
    await move.click();
    await expect(page.locator("#move-popover")).toHaveCount(0);
    await page.getByRole("button", { name: "Move variants", exact: true }).click();
    const menu = page.getByRole("menu", { name: "Move variants", exact: true });
    for (const name of ["Move content", "Duplicate", "Move area"]) {
        await expect(menu.getByRole("menuitemradio", { name, exact: true })).toBeVisible();
    }
    await page.keyboard.press("Escape");
    await move.click();
    await expect(move).toHaveAttribute("aria-pressed", "true");
    await expect(menu).toBeHidden();
});

test("overlay variants share one tool button with distinct icons and accessible names", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await bootApp(page);

    for (const [name, symbol] of [
        ["Place overlay", "#icon-overlay-place"],
        ["Clear overlay", "#icon-overlay-clear"],
        ["Invert overlay", "#icon-overlay-invert"],
    ] as const) {
        await chooseToolVariant(page, "Overlay", name.split(" ")[0]);
        const button = page.getByRole("button", { name, exact: true });
        await expect(button).toBeVisible();
        await expect(button).toHaveClass(/btn--icon/);
        await expect(button).toHaveText(name.split(" ")[0]);
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
    await expect(page.locator("#recipe-enabled")).toHaveCount(0);
    await expect(page.getByText("Repeat while drawing", { exact: true })).toHaveCount(0);
});
