import { expect, test } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB, chooseToolVariant as choose } from "./_helpers";

test("right Pencil projects the executing yarn and restores the latest choice", async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 2, 2);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "right" });
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#swatch-a")).toHaveAttribute("aria-pressed", "false");
    await page.keyboard.press("2");
    await page.keyboard.press("1");
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.up({ button: "right" });
    await expect(page.locator("#swatch-a")).toHaveAttribute("aria-pressed", "true");
});

for (const cancellation of ["pointercancel", "lostpointercapture", "blur"] as const) test(
    `${cancellation} restores the latest chosen yarn after alternate Pencil`, async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 2, 2);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "right" });
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("2");
    await page.keyboard.press("1");
    await page.evaluate(event => {
        if (event === "blur") window.dispatchEvent(new Event(event));
        else document.getElementById("canvas")!.dispatchEvent(new PointerEvent(event, { pointerId: 1, bubbles: true }));
    }, cancellation);
    await expect(page.locator("#swatch-a")).toHaveAttribute("aria-pressed", "true");
    await page.mouse.up({ button: "right" });
});

test("pen barrel button projects the alternate Pencil yarn through the shared pointer flow", async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 2, 2);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchMouseEvent", { type: "mousePressed", x: cell.cx, y: cell.cy,
        button: "right", buttons: 2, clickCount: 1, pointerType: "pen" });
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#status-action")).toHaveText("Pencil · Yarn B");
    await session.send("Input.dispatchMouseEvent", { type: "mouseReleased", x: cell.cx, y: cell.cy,
        button: "right", buttons: 0, clickCount: 1, pointerType: "pen" });
    await expect(page.locator("#swatch-a")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#status-action")).toBeHidden();
});

test("double press opens the main tool menu and a single press only chooses the tool", async ({ page }) => {
    await bootApp(page);
    const tool = page.locator("#tool-select");
    const menu = page.getByRole("menu", { name: "Rectangle variants", exact: true });
    await tool.click();
    await expect(menu).toBeHidden();
    await tool.dblclick();
    await expect(menu).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(tool).toBeFocused();
    await tool.press("ArrowDown");
    await expect(menu).toBeVisible();
});

test("Rectangle menu expansion remains independent of the Selection inspector", async ({ page }) => {
    await bootApp(page);
    const tool = page.locator("#tool-select");
    await tool.click();
    await expect(page.locator("#selection-popover")).toBeVisible();
    await expect(tool).toHaveAttribute("aria-expanded", "false");
    await tool.press("ArrowDown");
    await expect(tool).toHaveAttribute("aria-expanded", "true");
    await page.keyboard.press("Escape");
    await expect(tool).toHaveAttribute("aria-expanded", "false");
    await expect(page.locator("#selection-popover")).toBeVisible();
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await tool.press("ArrowDown");
    await expect(tool).toHaveAttribute("aria-expanded", "true");
});

test("middle Pencil inverts without panning or changing the chosen tool or yarn", async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 2, 2);
    const before = await pixelRGB(page, cell.cx, cell.cy);
    const matrix = await page.evaluate(() => window.__test_matrix__!.toString());
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "middle" });
    await expect(page.locator("#tool-invert")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#status-action")).toContainText("Invert");
    await expect(page.locator("#status-action")).toBeVisible();
    await page.mouse.up({ button: "middle" });
    expect(await pixelRGB(page, cell.cx, cell.cy)).not.toEqual(before);
    expect(await page.evaluate(() => window.__test_matrix__!.toString())).toBe(matrix);
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#swatch-a")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#status-action")).toBeHidden();
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
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#tool-eraser")).toHaveAttribute("aria-pressed", "false");
    await page.mouse.move(end.cx, end.cy);
    expect(await pixelRGB(page, end.cx, end.cy)).toEqual([0, 0, 0]);
    await page.keyboard.press("2");
    await expect(page.locator("#status-action")).toContainText("Pencil · Yarn A");
    await expect(page.locator("#status-action")).toBeVisible();
    await page.mouse.up();
    await expect(page.locator("#status-action")).toBeHidden();
    expect(await pixelRGB(page, end.cx, end.cy)).toEqual([0, 0, 0]);
    await expect(page.locator("#tool-eraser")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#swatch-b")).toHaveAttribute("aria-pressed", "true");
});

test("held Rectangle shows its temporary icon and restores the remembered variant on release", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    const cell = await cellCoord(page, 2, 2);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "right" });
    await expect(page.locator("#tool-select use")).toHaveAttribute("href", "#icon-select-add");
    await expect(page.locator("#tool-select")).toHaveAccessibleDescription(/Rectangle · Add/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.toolVariants.select)).toBe("replace");
    await page.mouse.up({ button: "right" });
    await expect(page.locator("#tool-select use")).toHaveAttribute("href", "#icon-select");
    await expect(page.locator("#status-action")).toBeHidden();
    await page.locator("#tool-select").press("ArrowDown");
    await expect(page.getByRole("menuitemradio", { name: "Replace", exact: true })).toHaveAttribute("aria-checked", "true");
});

test("keyboard Move shows the temporary variant only until key release", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 2, 2);
    await page.keyboard.press("m");
    await page.keyboard.down("Control");
    await page.keyboard.down("ArrowRight");
    await expect(page.locator("#tool-move use")).toHaveAttribute("href", "#icon-copy");
    await expect(page.locator("#status-action")).toContainText("Duplicate");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("Control");
    await expect(page.locator("#tool-move use")).toHaveAttribute("href", "#icon-move");
    await expect(page.locator("#status-action")).toBeHidden();
});

test("a held action keeps its starting variant while a new choice is remembered for release", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    const cell = await cellCoord(page, 2, 2);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "right" });
    await expect(page.locator("#tool-select use")).toHaveAttribute("href", "#icon-select-add");
    await page.locator("#tool-select").evaluate(button => button.dispatchEvent(new KeyboardEvent("keydown", { key: "ArrowDown", bubbles: true })));
    await page.getByRole("menuitemradio", { name: "Subtract", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("#tool-select use")).toHaveAttribute("href", "#icon-select-add");
    await expect(page.locator("#tool-select")).toHaveAttribute("data-variant", "remove");
    await page.mouse.up({ button: "right" });
    await expect(page.locator("#tool-select use")).toHaveAttribute("href", "#icon-select-remove");
    await expect(page.locator("#status-action")).toBeHidden();
});

for (const [family, tool, chosen, button, modifiers, icon, restored] of [
    ["Wand", "wand", "Replace", "right", [], "wand-add", "wand"],
    ["Wand", "wand", "Replace", "middle", [], "wand-remove", "wand"],
    ["Rectangle", "select", "Replace", "middle", ["Shift", "Control"], "select-add", "select"],
    ["Move", "move", "Move content", "right", ["Alt", "Control"], "move-area", "move"],
    ["Overlay", "overlay", "Place", "right", [], "overlay-clear", "overlay-place"],
    ["Overlay", "overlay", "Clear", "middle", [], "overlay-invert", "overlay-clear"],
] as const) test(`${family} ${button} held action shows ${icon} and restores its chosen icon`, async ({ page }) => {
    await bootApp(page);
    await choose(page, family, chosen);
    const cell = await cellCoord(page, 2, 2);
    for (const modifier of modifiers) await page.keyboard.down(modifier);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button });
    await expect(page.locator(`#tool-${tool} use`)).toHaveAttribute("href", `#icon-${icon}`);
    await expect(page.locator(`#tool-${tool}`)).toHaveAttribute("aria-pressed", "true");
    await page.mouse.up({ button });
    for (const modifier of [...modifiers].reverse()) await page.keyboard.up(modifier);
    await expect(page.locator(`#tool-${tool} use`)).toHaveAttribute("href", `#icon-${restored}`);
    await expect(page.locator("#status-action")).toBeHidden();
});

for (const cancellation of ["pointercancel", "lostpointercapture", "blur"] as const) test(
    `${cancellation} clears held feedback and restores the latest chosen tool`, async ({ page }) => {
    await bootApp(page);
    const cell = await cellCoord(page, 2, 2);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down({ button: "middle" });
    await expect(page.locator("#tool-invert")).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("e");
    await expect(page.locator("#tool-invert")).toHaveAttribute("aria-pressed", "true");
    await page.evaluate(event => {
        if (event === "blur") window.dispatchEvent(new Event(event));
        else document.getElementById("canvas")!.dispatchEvent(new PointerEvent(event, { pointerId: 1, bubbles: true }));
    }, cancellation);
    await expect(page.locator("#tool-eraser")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#tool-invert")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#status-action")).toBeHidden();
    await page.mouse.up({ button: "middle" });
});

test("chosen variants remain described with enlarged text", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 960 });
    await bootApp(page);
    await page.evaluate(() => { document.documentElement.style.fontSize = "32px"; });
    for (const [id, family] of [["select", "Rectangle"], ["wand", "Wand"], ["move", "Move"], ["overlay", "Overlay"]]) {
        await expect(page.locator(`#tool-${id}`)).toHaveAccessibleDescription(new RegExp(family));
        await page.locator(`#tool-${family === "Rectangle" ? "select" : family === "Wand" ? "wand" : family === "Move" ? "move" : "overlay"}`).press("ArrowDown");
        await expect(page.getByRole("menu", { name: `${family} variants`, exact: true })).toBeVisible();
        await page.keyboard.press("Escape");
    }
});

for (const change of ["scroll", "resize"]) test(`external ${change} dismisses a menu while its own scroll remains usable`, async ({ page }) => {
    await bootApp(page);
    const trigger = page.locator("#tool-move");
    const menu = page.getByRole("menu", { name: "Move variants", exact: true });
    await trigger.press("ArrowDown");
    await menu.evaluate(element => element.dispatchEvent(new Event("scroll")));
    await expect(menu).toBeVisible();
    if (change === "resize") await page.setViewportSize({ width: 900, height: 700 });
    else await page.locator("#authoring-dock").evaluate(element => element.dispatchEvent(new Event("scroll")));
    await expect(menu).toBeHidden();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
});

test("group menus preserve choices on open and Escape and support keyboard selection", async ({ page }) => {
    await bootApp(page);
    const trigger = page.locator("#tool-select");
    await trigger.press("ArrowDown");
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
    const trigger = page.locator("#tool-move");
    const menu = page.getByRole("menu", { name: "Move variants", exact: true });
    await trigger.press("ArrowDown");
    await page.locator("#swatch-b").click();
    await expect(menu).toBeHidden();
    await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
    await trigger.press("ArrowDown");
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
