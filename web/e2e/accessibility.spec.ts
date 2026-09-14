import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell } from "./_helpers";

test("active tool and yarn expose their selected state", async ({ page }) => {
    await bootApp(page);
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
    const row = page.getByRole("radio", { name: "Rows" });
    const round = page.getByRole("radio", { name: "Centre-out" });
    await row.focus();
    await page.keyboard.press("ArrowRight");
    await expect(round).toBeChecked();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    const labels = page.getByRole("checkbox", { name: "Show numbers" });
    await expect(labels).toBeChecked();
    await labels.focus();
    await page.keyboard.press("Space");
    await expect(labels).not.toBeChecked();
});

test("context strip follows the active tool, yarn, selection, and transforms", async ({ page }) => {
    await bootApp(page);
    const status = page.locator("#status");

    await expect(status).toContainText("Colour · Pencil");
    await expect(status).toContainText("Yarn A");

    await page.getByRole("button", { name: "Fill" }).click();
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await expect(status).toContainText("Colour · Fill");
    await expect(status).toContainText("Yarn B");

    await page.getByRole("button", { name: "Overlay" }).click();
    await expect(status).toContainText("Overlay placement");

    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await expect(status).toContainText("1 selected");

    const hovered = await cellCoord(page, 1, 1);
    await page.mouse.move(hovered.cx, hovered.cy);
    await expect(status).toContainText("1, 1");

    await page.locator("#btn-sym-toggle").click();
    await page.locator("#add-sym-v").click();
    await expect(status).toContainText("Transforms live");

    await page.locator("label:has(#live-transforms)").click();
    await expect(status).toContainText("Transforms paused");
});

test("yarn controls expose select, edit, and undoable swap actions", async ({ page }) => {
    await bootApp(page);
    const yarnA = page.getByRole("button", { name: "Yarn A", exact: true });
    const yarnB = page.getByRole("button", { name: "Yarn B", exact: true });
    const edit = page.locator("#edit-yarn");
    const swap = page.getByRole("button", { name: "Swap yarns" });

    await expect(yarnA).toContainText("A");
    await expect(yarnB).toContainText("B");
    await expect(yarnA).toHaveAttribute("aria-pressed", "true");
    await expect(edit).toBeVisible();
    await expect(swap).toBeVisible();

    await yarnB.focus();
    await page.keyboard.press("Space");
    await expect(edit).toHaveAccessibleName("Edit Yarn B");
    await yarnA.focus();
    await page.keyboard.press("Enter");
    await expect(edit).toHaveAccessibleName("Edit Yarn A");
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
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.keyboard.press("Escape");
    await expect(more).toBeFocused();
});
