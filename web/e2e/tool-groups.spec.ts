import { expect, test } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB, chooseToolVariant as choose } from "./_helpers";

test("middle Pencil inverts without panning or changing the chosen tool or yarn", async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 2, 2);
    const before = await pixelRGB(page, cell.cx, cell.cy);
    const matrix = await page.evaluate(() => window.__test_matrix__!.toString());
    await clickCell(page, 2, 2, { button: "middle" });
    expect(await pixelRGB(page, cell.cx, cell.cy)).not.toEqual(before);
    expect(await page.evaluate(() => window.__test_matrix__!.toString())).toBe(matrix);
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#swatch-a")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#status-action")).toContainText("Invert");
    await expect(page.locator("#status-action")).toBeVisible();
});

test("right Rectangle adds and middle subtracts, with Shift ahead of either button", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await clickCell(page, 3, 1, { button: "right" });
    await expect(page.locator("#status-selection")).toHaveText("2 selected");
    await clickCell(page, 1, 1, { button: "middle" });
    await expect(page.locator("#status-selection")).toHaveText("1 selected");
    await clickCell(page, 5, 1, { button: "middle", modifiers: ["Shift", "Control"] });
    await expect(page.locator("#status-selection")).toHaveText("2 selected");
});

test("a held stroke keeps its starting tool and yarn when shortcuts change chosen state", async ({ page }) => {
    await bootApp(page);
    const start = await cellCoord(page, 1, 1);
    const end = await cellCoord(page, 2, 1);
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.keyboard.press("e");
    await page.mouse.move(end.cx, end.cy);
    expect(await pixelRGB(page, end.cx, end.cy)).toEqual([0, 0, 0]);
    await page.keyboard.press("2");
    await expect(page.locator("#status-action")).toContainText("Pencil · Yarn A");
    await expect(page.locator("#status-action")).toBeVisible();
    await page.mouse.up();
    expect(await pixelRGB(page, end.cx, end.cy)).toEqual([0, 0, 0]);
    await expect(page.locator("#tool-eraser")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
});

test("chosen variants remain described with enlarged text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 960 });
    await bootApp(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    for (const [id, family] of [["select", "Rectangle"], ["wand", "Wand"], ["move", "Move"], ["overlay", "Overlay"]]) {
        await expect(page.locator(`#tool-${id}`)).toHaveAccessibleDescription(new RegExp(family));
        await page.getByRole("button", { name: `${family} variants`, exact: true }).click();
        await expect(page.getByRole("menu", { name: `${family} variants`, exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
    }
});

for (const change of ["scroll", "resize"]) test(`external ${change} dismisses a menu while its own scroll remains usable`, async ({ page }) => {
    await bootApp(page);
    const trigger = page.getByRole("button", { name: "Move variants", exact: true });
    const menu = page.getByRole("menu", { name: "Move variants", exact: true });
    await trigger.click();
    await menu.evaluate(element => element.dispatchEvent(new Event("scroll")));
    await expect(menu).toBeVisible();
    if (change === "resize") await page.setViewportSize({ width: 900, height: 700 });
    else await page.locator("#authoring-dock").evaluate(element => element.dispatchEvent(new Event("scroll")));
    await expect(menu).toBeHidden();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
});

test("group menus preserve choices on open and Escape and support keyboard selection", async ({ page }) => {
    await bootApp(page);
    const trigger = page.getByRole("button", { name: "Rectangle variants", exact: true });
    await trigger.click();
    await expect(trigger).toHaveAttribute("aria-expanded", "true");
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(trigger).toBeFocused();
    await expect(trigger).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await trigger.press("ArrowDown");
    await page.keyboard.press("End");
    await page.keyboard.press("Enter");
    await expect(page.locator("#tool-select")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#tool-select")).toHaveAttribute("data-variant", "remove");
    await expect(page.locator("#tool-select")).toHaveAccessibleDescription(/Rectangle · Subtract/);
    await expect(page.locator("#selection-mode-controls")).toHaveCount(0);
});

test("each family remembers its chosen variant after leaving, an empty selection and reload", async ({ page }) => {
    await bootApp(page);
    await choose(page, "Rectangle", "Add");
    await choose(page, "Wand", "Subtract");
    await choose(page, "Move", "Duplicate");
    await choose(page, "Overlay", "Clear");
    await page.keyboard.press("p");
    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    for (const [id, variant, label] of [["select", "add", "Add"], ["wand", "remove", "Subtract"], ["move", "duplicate", "Duplicate"], ["overlay", "clear", "Clear"]]) {
        await expect(page.locator(`#tool-${id}`)).toHaveAttribute("data-variant", variant);
        await expect(page.locator(`#tool-${id}`)).toHaveAccessibleDescription(new RegExp(label));
    }
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).version)).toBe(9);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots
        .some((snapshot: object) => JSON.stringify(snapshot).includes("toolVariants")))).toBe(false);
});

test("Overlay keyboard activation retains its chosen variant", async ({ page }) => {
    await bootApp(page);
    for (const variant of ["Clear", "Invert"]) {
        await choose(page, "Overlay", variant);
        await page.keyboard.press("p");
        await page.keyboard.press("o");
        await expect(page.locator("#tool-overlay")).toHaveAccessibleDescription(new RegExp(`Overlay · ${variant}`));
    }
});

test("Overlay hints describe the chosen action rather than a fixed Place action", async ({ page }) => {
    await bootApp(page);
    for (const variant of ["Clear", "Invert"]) {
        await choose(page, "Overlay", variant);
        await expect(page.locator("#tool-overlay")).not.toHaveAttribute("title", /right-click clears|Place an overlay/);
    }
});

test("right Move duplicates and middle Move moves the area", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    const source = await cellCoord(page, 1, 1);
    const target = await cellCoord(page, 3, 1);
    await page.mouse.move(source.cx, source.cy);
    await page.mouse.down({ button: "right" });
    await page.mouse.move(target.cx, target.cy, { steps: 3 });
    await expect(page.locator("#status-action")).toContainText("Duplicate");
    await page.mouse.up({ button: "right" });
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual([0, 0, 0]);
    const area = await cellCoord(page, 5, 1);
    await page.mouse.move(target.cx, target.cy);
    await page.mouse.down({ button: "middle" });
    await page.mouse.move(area.cx, area.cy, { steps: 3 });
    await page.mouse.up({ button: "middle" });
    expect(await pixelRGB(page, target.cx, target.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, area.cx, area.cy)).toEqual([255, 255, 255]);
    await expect(page.locator("#move-popover")).toHaveCount(0);
});

test("hold opens a group without activating it and suppresses the release click", async ({ page }) => {
    await bootApp(page);
    const button = page.locator("#tool-wand");
    const box = (await button.boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    await expect(page.getByRole("menu", { name: "Wand variants", exact: true })).toBeVisible();
    await page.mouse.up();
    await expect(page.getByRole("menu", { name: "Wand variants", exact: true })).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await expect(button).toBeFocused();
});

test("temporary feedback clears on cancel and leaves operation warnings intact", async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 1, 1);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "right" });
    await expect(page.locator("#status-action")).toContainText("Pencil · Yarn B");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(page.locator("#status-action")).toBeHidden();
    await page.mouse.up({ button: "right" });
    await page.keyboard.press("m");
    await clickCell(page, 1, 1, { button: "right" });
    await expect(page.locator("#status-feedback")).toHaveText("No selection");
});

test("group dismissal by an outside focus or pointer preserves the chosen tool", async ({ page }) => {
    await bootApp(page);
    const trigger = page.getByRole("button", { name: "Move variants", exact: true });
    const menu = page.getByRole("menu", { name: "Move variants", exact: true });
    await trigger.click();
    await page.locator("#swatch-b").click();
    await expect(menu).toBeHidden();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await trigger.click();
    await page.locator("#canvas").focus();
    await expect(menu).toBeHidden();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
});

test("holding and releasing outside the tool leaves the menu available without an edit", async ({ page }) => {
    await bootApp(page);
    const box = (await page.locator("#tool-select").boundingBox())!;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.down();
    const menu = page.getByRole("menu", { name: "Rectangle variants", exact: true });
    await expect(menu).toBeVisible();
    const cell = await cellCoord(page, 4, 4);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.up();
    await expect(menu).toBeVisible();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(page.locator("#tool-select")).toBeFocused();
});

test("Navigate and Crochet right-click do not edit; middle-click remains navigation", async ({ page }) => {
    await bootApp(page);
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document);
    await page.locator("#view-navigate").click();
    await clickCell(page, 1, 1, { button: "right" });
    await clickCell(page, 1, 1, { button: "middle" });
    await page.locator("#btn-export").click();
    await clickCell(page, 1, 1, { button: "right" });
    await clickCell(page, 1, 1, { button: "middle" });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document)).toEqual(before);
});

test("middle Overlay inverts, respects the chosen yarn, and keeps the chosen Place action", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("o");
    await page.keyboard.press("2");
    const cell = await cellCoord(page, 2, 1);
    const before = await pixelRGB(page, cell.cx, cell.cy);
    await clickCell(page, 2, 1, { button: "middle" });
    expect(await pixelRGB(page, cell.cx, cell.cy)).not.toEqual(before);
    await expect(page.locator("#tool-overlay")).toHaveAccessibleDescription(/Overlay · Place/);
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
    await clickCell(page, 2, 1, { button: "middle" });
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(before);
});
