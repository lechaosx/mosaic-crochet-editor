import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

test("active tool and yarn expose their selected state", async ({ page }) => {
    await bootApp(page);
    await expect(page.getByRole("img", { name: "Editable pattern chart" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Colour tools" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Overlay tools" })).toBeVisible();
    await expect(page.getByRole("group", { name: "Arrange tools" })).toBeVisible();
    const pencil = page.getByRole("button", { name: "Pencil" });
    const fill = page.getByRole("button", { name: "Fill" });
    const primary = page.getByRole("button", { name: "Yarn A", exact: true });
    const secondary = page.getByRole("button", { name: "Yarn B", exact: true });

    await expect(pencil).toHaveAttribute("aria-pressed", "true");
    await expect(fill).toHaveAttribute("aria-pressed", "false");
    await fill.click();
    await expect(pencil).toHaveAttribute("aria-pressed", "false");
    await expect(fill).toHaveAttribute("aria-pressed", "true");

    await expect(primary).toHaveAttribute("aria-pressed", "true");
    await expect(secondary).toHaveAttribute("aria-pressed", "false");
    await secondary.click();
    await expect(primary).toHaveAttribute("aria-pressed", "false");
    await expect(secondary).toHaveAttribute("aria-pressed", "true");
});

test("segmented radios and switches retain native keyboard operation", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.getByRole("radiogroup", { name: "Pattern geometry" })).toBeVisible();
    const row = page.getByRole("radio", { name: "Rows" });
    const round = page.getByRole("radio", { name: "Centre-out" });
    await row.focus();
    await page.keyboard.press("ArrowRight");
    await expect(round).toBeChecked();
    await expect(page.getByRole("radiogroup", { name: "Authored extent" })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    const labels = page.getByRole("checkbox", { name: "Show numbers" });
    await expect(labels).toBeChecked();
    await labels.focus();
    await page.keyboard.press("Space");
    await expect(labels).not.toBeChecked();
});

test("context strip only shows information not visible in controls", async ({ page }) => {
    await bootApp(page);
    const status = page.locator("#status");

    await expect(status).toBeHidden();

    await page.getByRole("button", { name: "Fill" }).click();
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await expect(status).toBeHidden();

    await page.getByRole("button", { name: "Place overlay", exact: true }).click();
    await expect(status).toBeHidden();

    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await expect(status).toContainText("1 selected");

    const hovered = await cellCoord(page, 1, 1);
    await page.mouse.move(hovered.cx, hovered.cy);
    await expect(status).toContainText("1, 1");
    await expect(page.locator("#status-selection")).toBeHidden();

    await page.locator("#btn-sym-toggle").click();
    await page.locator("#add-sym-v").click();
    await expect(status).not.toContainText("Transforms live");

    await page.locator("label:has(#live-transforms)").click();
    await expect(status).not.toContainText("Transforms paused");
});

test("yarn controls expose direct selection and Pattern owns editing actions", async ({ page }) => {
    await bootApp(page);
    const yarnA = page.getByRole("button", { name: "Yarn A", exact: true });
    const yarnB = page.getByRole("button", { name: "Yarn B", exact: true });

    await expect(yarnA).toContainText("A");
    await expect(yarnB).toContainText("B");
    await expect(yarnA).toHaveAttribute("aria-pressed", "true");

    await yarnB.focus();
    const focusOutline = await yarnB.evaluate(element => {
        const style = getComputedStyle(element);
        return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) };
    });
    expect(focusOutline.style).toBe("solid");
    expect(focusOutline.width).toBeGreaterThanOrEqual(2);
    await page.keyboard.press("Space");
    await page.getByRole("button", { name: "Pattern" }).click();
    const swap = page.getByRole("button", { name: "Swap yarn colours" });
    await expect(page.locator("#edit-yarn")).toHaveCount(0);
    await expect(swap).toBeVisible();
    await expect(swap).toHaveText("⇄");
    await yarnB.click();

    const before = await page.evaluate(() => ({
        a: (document.getElementById("color-a") as HTMLInputElement).value,
        b: (document.getElementById("color-b") as HTMLInputElement).value,
    }));
    await swap.click();
    await expect(yarnB).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#color-a")).toHaveValue(before.b);
    await expect(page.locator("#color-b")).toHaveValue(before.a);

    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#color-a")).toHaveValue(before.a);
    await expect(page.locator("#color-b")).toHaveValue(before.b);
});

test("double-click and long-press invoke the chosen yarn picker from the dock", async ({ page }) => {
    await bootApp(page);
    const yarnA = page.getByRole("button", { name: "Yarn A", exact: true });
    const yarnB = page.getByRole("button", { name: "Yarn B", exact: true });
    const colorA = page.getByLabel("Yarn A colour");
    const colorB = page.getByLabel("Yarn B colour");
    await colorA.evaluate(input => input.addEventListener("click", event => {
        event.preventDefault();
        (input as HTMLElement).dataset.pickerInvoked = "true";
    }));
    await colorB.evaluate(input => input.addEventListener("click", event => {
        event.preventDefault();
        (input as HTMLElement).dataset.pickerInvoked = "true";
    }));

    await yarnA.dblclick();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    await expect(colorA).toHaveAttribute("data-picker-invoked", "true");

    await page.keyboard.press("Escape");
    const box = (await yarnB.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await page.waitForTimeout(550);
    await page.mouse.up();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    await expect(colorB).toHaveAttribute("data-picker-invoked", "true");
});

test("dynamic symmetry actions name their axis and position", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
    await page.getByRole("button", { name: "Add vertical" }).click();

    const disable = page.getByRole("button", { name: "Disable vertical axis at x=4" });
    await expect(disable).toBeVisible();
    await expect(page.getByRole("button", { name: "Delete vertical axis at x=4" })).toBeVisible();

    await disable.click();
    await expect(page.getByRole("button", { name: "Enable vertical axis at x=4" })).toBeVisible();
});

test("dynamic symmetry actions retain keyboard focus after rebuilding the axis list", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
    await page.getByRole("button", { name: "Add vertical" }).click();
    await page.getByRole("button", { name: "Add horizontal" }).click();

    const disableVertical = page.getByRole("button", { name: "Disable vertical axis at x=4" });
    await disableVertical.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Enable vertical axis at x=4" })).toBeFocused();

    const deleteVertical = page.getByRole("button", { name: "Delete vertical axis at x=4" });
    await deleteVertical.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Delete horizontal axis at y=4" })).toBeFocused();

    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Add horizontal" })).toBeFocused();
});

test("closing an inspector restores focus to the available authoring context", async ({ page }) => {
    await bootApp(page);

    const settings = page.getByRole("button", { name: "Settings" });
    await settings.click();
    await page.getByRole("button", { name: "Close inspector" }).click();
    await expect(settings).toBeFocused();

    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: /selected/ }).click();
    await page.getByRole("button", { name: "Deselect" }).click();
    await expect(page.getByRole("button", { name: "Pencil" })).toBeFocused();

    await page.setViewportSize({ width: 360, height: 740 });
    const more = page.getByRole("button", { name: "More" });
    await more.click();
    await page.getByRole("menuitem", { name: "Pattern" }).click();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
});

test("compact More exposes and navigates a keyboard menu", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);

    const more = page.getByRole("button", { name: "More" });
    await more.focus();
    await page.keyboard.press("Enter");

    const pattern = page.getByRole("menuitem", { name: "Pattern" });
    await expect(pattern).toBeFocused();
    await page.keyboard.press("ArrowDown");
    await expect(page.getByRole("menuitem", { name: "Open" })).toBeFocused();
    await page.keyboard.press("End");
    await expect(page.getByRole("menuitem", { name: "Settings" })).toBeFocused();
    await page.keyboard.press("Home");
    await expect(pattern).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
    await expect(more).toHaveAttribute("aria-expanded", "false");

    await page.setViewportSize({ width: 1280, height: 720 });
    await expect(page.getByRole("menuitem")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
});

test("Tab leaves and closes the compact More menu", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);

    const more = page.getByRole("button", { name: "More" });
    await more.click();
    await page.keyboard.press("Tab");
    await expect(page.locator("#more-popover")).toBeHidden();
    await expect(page.getByRole("button", { name: "Begin Crocheting" })).toBeFocused();

    await more.click();
    await page.keyboard.press("Shift+Tab");
    await expect(page.locator("#more-popover")).toBeHidden();
});

test("compact menu navigation does not move selected canvas content", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await expect(page.getByRole("button", { name: /selected/ })).toBeVisible();

    await page.getByRole("button", { name: "More" }).click();
    await page.keyboard.press("ArrowDown");
    await page.locator("#more-popover").evaluate((popover: HTMLElement) => popover.hidePopover());
    await page.getByRole("button", { name: /selected/ }).click();
    await page.getByRole("button", { name: "Deselect" }).click();

    const original = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, original.cx, original.cy)).toEqual([0, 0, 0]);
});

test("Escape closes an inspector before applying a canvas shortcut", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    const selection = page.getByRole("button", { name: /selected/ });
    await selection.click();

    await page.keyboard.press("Escape");
    await expect(page.locator("#inspector-host")).toBeHidden();
    await expect(selection).toBeVisible();
    await expect(selection).toBeFocused();

    await page.keyboard.press("Escape");
    await expect(selection).toBeHidden();

    const settings = page.getByRole("button", { name: "Settings" });
    await settings.click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#inspector-host")).toBeHidden();
    await expect(settings).toBeFocused();
});

test("visible buttons provide hover labels across editor surfaces", async ({ page }) => {
    await bootApp(page);
    const expectHoverLabels = async (surface: string) => {
        const missing = await page.locator("button:visible").evaluateAll(buttons =>
            buttons.filter(button => !button.title.trim())
                .map(button => button.id || button.textContent?.trim() || "unnamed"),
        );
        expect(missing, surface).toEqual([]);
    };

    await expectHoverLabels("Design");
    await page.getByRole("button", { name: "Settings" }).click();
    await expectHoverLabels("Settings inspector");
    await page.getByRole("button", { name: "Close inspector" }).click();

    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: /selected/ }).click();
    await expectHoverLabels("Selection inspector");
    await page.getByRole("button", { name: "Close inspector" }).click();

    await page.getByRole("button", { name: "Pattern" }).click();
    await expectHoverLabels("Pattern inspector");
    await page.getByRole("button", { name: "Close inspector" }).click();

    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
    await page.getByRole("button", { name: "Add vertical" }).click();
    await expectHoverLabels("Transform inspector");
    await page.getByRole("button", { name: "Close inspector" }).click();

    await page.locator("#btn-export").click();
    await expectHoverLabels("Crochet");
});

test("explicit inspector opening moves focus to its first available control", async ({ page }) => {
    await bootApp(page);

    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("slider", { name: "Guidance opacity" })).toBeFocused();
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: /selected/ }).click();
    await expect(page.getByRole("button", { name: "Move content" })).toBeFocused();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
    await expect(page.getByRole("button", { name: "Add vertical" })).toBeFocused();
    await page.keyboard.press("Escape");

    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.getByRole("radio", { name: "Rows" })).toBeFocused();

    await page.keyboard.press("Escape");
    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole("button", { name: "More" }).click();
    await page.getByRole("menuitem", { name: "Pattern" }).click();
    await expect(page.getByRole("radio", { name: "Rows" })).toBeFocused();
});
