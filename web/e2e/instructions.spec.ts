import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("a crocheter gets a focused workspace while the global document bar stays available", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await bootApp(page);
    await clickCell(page, 0, 1);
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save .mcw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Navigate" })).toBeVisible();
    await expect(page.getByLabel("Canvas context")).toBeHidden();
    await expect(page.getByText("Alternate direction", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeHidden();
    await page.evaluate(() => {
        (window as typeof window & { __designCanvas?: HTMLCanvasElement }).__designCanvas =
            document.getElementById("canvas") as HTMLCanvasElement;
    });
    const designViewport = await page.locator("#chart-viewport").boundingBox();

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Crochet", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save .mcw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Browser recovery" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Navigate" })).toBeHidden();
    await expect(page.getByLabel("Canvas context")).toBeHidden();
    await expect(page.getByRole("button", { name: "Fit view" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Zoom in" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Rotate view right" })).toBeVisible();
    await expect(page.locator(".canvas-area")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();
    await expect(page.locator("#canvas")).toBeVisible();
    await expect(page.getByRole("img", { name: "Crochet progress chart" })).toBeVisible();
    await expect(page.locator(".canvas-area > #chart-viewport > #canvas")).toHaveCount(1);
    expect(await page.locator("#chart-viewport").boundingBox()).toEqual(designViewport);
    expect(await page.evaluate(() => document.getElementById("canvas") ===
        (window as typeof window & { __designCanvas?: HTMLCanvasElement }).__designCanvas)).toBe(true);
    await expect(page.locator("canvas")).toHaveCount(1);
    await expect(page.locator("#instructions-units .instructions-unit").first()).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await expect(page.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("textbox", { name: "Compressed instructions" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Download text" })).toHaveCount(0);

    await page.getByRole("button", { name: "Design" }).click();
    await expect(page.locator(".canvas-area")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Design" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Navigate" })).toBeVisible();
    await expect(page.getByLabel("Canvas context")).toBeHidden();
    const painted = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, painted.cx, painted.cy)).toEqual([0, 0, 0]);
});

test("Crochet preserves and controls the shared chart viewport", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Invert colours" }).click();
    const designZoom = await page.getByRole("status", { name: "Rendered cell size" }).textContent();
    const designCell = await cellCoord(page, 1, 1);
    const designPixel = await pixelRGB(page, designCell.cx, designCell.cy);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator(".canvas-area #canvas")).toBeVisible();
    await expect(page.getByRole("status", { name: "Rendered cell size" })).toHaveText(designZoom!);
    await page.getByRole("button", { name: "Zoom in" }).click();
    const crochetZoom = await page.getByRole("status", { name: "Rendered cell size" }).textContent();
    expect(crochetZoom).not.toBe(designZoom);
    await clickCell(page, 1, 1);

    await page.getByRole("button", { name: "Design" }).click();

    await expect(page.locator(".canvas-area > #chart-viewport > #canvas")).toBeVisible();
    await expect(page.getByRole("status", { name: "Rendered cell size" })).toHaveText(crochetZoom!);
    const returnedCell = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, returnedCell.cx, returnedCell.cy)).toEqual(designPixel);
});

test("workspace switch remains direct in the compact toolbar", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    const canvasBefore = await page.locator(".canvas-area").boundingBox();
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("button", { name: "More" })).toBeVisible();
    expect(await page.locator(".canvas-area").boundingBox()).toEqual(canvasBefore);
    await page.getByRole("button", { name: "Design" }).click();
    await expect(page.getByRole("button", { name: "Design" })).toBeFocused();
});

test("only document-changing commands leave Crochet", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    const edited = await cellCoord(page, 1, 1);

    await page.getByRole("button", { name: "Crochet" }).click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
    expect(await pixelRGB(page, edited.cx, edited.cy)).toEqual([255, 255, 255]);

    await page.getByRole("button", { name: "Crochet" }).click();
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
    expect(await pixelRGB(page, edited.cx, edited.cy)).toEqual([0, 0, 0]);

    await page.getByRole("button", { name: "Crochet" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("button", { name: "Crochet", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.locator("#hl-popover")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.getByRole("button", { name: "Crochet" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();

    await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("10");
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeHidden();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
});

test("switching workspaces does not move selected Design content", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.keyboard.press("Control+a");

    await page.getByRole("button", { name: "Crochet" }).click();
    await page.getByRole("button", { name: "Design" }).click();
    await page.keyboard.press("Escape");

    const original = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, original.cx, original.cy)).toEqual([0, 0, 0]);
});

test("Design shortcuts are inert while Crochet is open", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Crochet" }).click();
    await page.keyboard.press("p");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Design" }).click();

    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /selected/ })).toBeVisible();
});

test("reselecting Crochet preserves its current line", async ({ page }) => {
    await bootApp(page);
    const crochet = page.getByRole("button", { name: "Crochet" });
    await crochet.click();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await crochet.click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet summarizes errors without blocking progress", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 2);
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("status", { name: "Crochet errors" })).toHaveText("1 error");
    await expect(page.locator('.instructions-unit[aria-label="Row 8, Yarn B"]')).toContainText("oc");
    await expect(page.locator('.instructions-unit[aria-label="Row 9, Yarn A"]')).toContainText("oc");
    await expect(page.getByLabel("Instruction blockers")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
});

test("Crochet advances by whole rows and resumes the exact instruction plan", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("img", { name: "Crochet progress chart" })).toBeVisible();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Back one row" })).toBeDisabled();

    await page.getByRole("button", { name: "Forward one row" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Back one row" })).toBeEnabled();

    await page.getByRole("button", { name: "Design" }).click();
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");

    await page.getByRole("button", { name: "Design" }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");

    await page.getByRole("button", { name: "Design" }).click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("10");
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toContainText("sc × 10");

    await page.getByRole("button", { name: "Design" }).click();
    await page.locator("#edit-width").fill("9");
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet lines are compact progress controls", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await bootApp(page);
    await page.locator("#color-a").evaluate((input: HTMLInputElement) => {
        input.value = "#123456";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.locator("#color-b").evaluate((input: HTMLInputElement) => {
        input.value = "#abcdef";
        input.dispatchEvent(new Event("input", { bubbles: true }));
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await page.getByRole("button", { name: "Crochet" }).click();

    const first = page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]');
    const second = page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]');
    const third = page.locator('.instructions-unit[aria-label="Row 3, Yarn A"]');
    await expect(first).not.toContainText("Row");
    await expect(first).not.toContainText("Yarn");
    await expect(first.locator(".instructions-unit-number")).toHaveText("1");
    await expect(first.locator(".instructions-unit-yarn")).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect(second.locator(".instructions-unit-yarn")).toHaveCSS("background-color", "rgb(171, 205, 239)");
    await expect(first.locator("code")).toHaveCSS("white-space", "normal");
    await expect(page.locator("#instructions-units")).toHaveCSS("overflow-y", "auto");
    await expect(page.locator("#instructions-units")).toHaveCSS("overflow-x", "hidden");
    const workspace = await page.locator(".workspace").boundingBox();
    const panel = await page.getByRole("complementary", { name: "Crochet" }).boundingBox();
    expect(panel!.x).toBe(workspace!.x);
    expect(panel!.y).toBe(workspace!.y);
    expect(panel!.height).toBe(workspace!.height);

    const current = page.getByRole("status", { name: "Current instruction" });
    await expect(current).toHaveText("sc × 9");
    const currentBox = await current.boundingBox();
    expect(currentBox!.x).toBeGreaterThanOrEqual(panel!.x + panel!.width);
    expect(currentBox!.y + currentBox!.height).toBeLessThanOrEqual(workspace!.y + workspace!.height);
    const fittedPatternCentre = workspace!.x + workspace!.width / 2;
    expect(Math.abs(currentBox!.x + currentBox!.width / 2 - fittedPatternCentre)).toBeLessThan(1);
    expect(await current.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

    await third.click();
    await expect(third).toHaveAttribute("aria-current", "step");
    await expect(page.locator("#instructions-live-progress")).toHaveText("3 / 9");
    await expect(current).toHaveText("sc × 9");

    const back = page.getByRole("button", { name: "Back one row" });
    const forward = page.getByRole("button", { name: "Forward one row" });
    await expect(back).toBeEnabled();
    await expect(forward).toBeEnabled();
    await page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]').click();
    await expect(back).toBeDisabled();
    await page.locator('.instructions-unit[aria-label="Row 9, Yarn A"]').click();
    await expect(forward).toBeDisabled();
});

test("alternate direction switches cached instructions without regenerating", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();
    const copy = page.getByRole("button", { name: "Copy instructions" });
    await expect(copy).toBeEnabled();

    await page.getByText("Alternate direction", { exact: true }).click();

    await expect(copy).toBeEnabled();
    await expect(page.locator("#export-progress")).toBeHidden();
});

test("Crochet renders through the current row and no future rows", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const rowCount = await page.locator("#instructions-units .instructions-unit").count();
    await page.getByRole("button", { name: "Fit view" }).click();
    const currentRow1 = await cellCoord(page, 4, rowCount - 1);
    const futureRow2 = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, futureRow2.cx, futureRow2.cy)).toEqual([22, 22, 24]);
    expect(await pixelRGB(page, currentRow1.cx, currentRow1.cy)).not.toEqual([22, 22, 24]);

    await page.getByRole("button", { name: "Forward one row" }).click();
    const completedRow1 = await cellCoord(page, 4, rowCount - 1);
    expect(await pixelRGB(page, completedRow1.cx, completedRow1.cy)).not.toEqual([22, 22, 24]);
    const currentRow2 = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, currentRow2.cx, currentRow2.cy)).not.toEqual([22, 22, 24]);

    await page.getByRole("button", { name: "Back one row" }).click();
    const futureAgain = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, futureAgain.cx, futureAgain.cy)).toEqual([22, 22, 24]);
});

test("Crochet progress remains available when the chart has errors", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByText(/resolve chart/i)).toHaveCount(0);
});

test("Crochet reports when its progress cannot be saved locally", async ({ page }) => {
    await page.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (key, value) {
            if (key === "mosaic-live-progress") {
                throw new DOMException("full", "QuotaExceededError");
            }
            return setItem.call(this, key, value);
        };
    });
    await bootApp(page);

    await page.getByRole("button", { name: "Crochet" }).click();
    await page.getByRole("button", { name: "Forward one row" }).click();

    await expect(page.getByRole("alert"))
        .toHaveText("Progress not saved");
    await page.getByRole("button", { name: "Design" }).click();
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet keeps a single Centre-out round at both progress limits", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByLabel("Rounds").fill("1");

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Round 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    const back = page.getByRole("button", { name: "Back one round" });
    await expect(back).toBeDisabled();
    await expect(page.locator("#instructions-live-progress")).toHaveText("1 / 1");
    await expect(page.getByRole("button", { name: "Forward one round" })).toBeDisabled();
});

test("Crochet reports copy completion", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async () => undefined },
        });
    });
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();
    const status = page.getByRole("status", { name: "Copy instructions status" });
    await expect(page.getByRole("button", { name: "Copy instructions" })).toHaveText("");

    await page.getByRole("button", { name: "Copy instructions" }).click();
    await expect(status).toHaveText("Copied");
});

test("Crochet reports clipboard failure", async ({ page }) => {
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async () => { throw new DOMException("denied", "NotAllowedError"); } },
        });
    });
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();

    await page.getByRole("button", { name: "Copy instructions" }).click();
    await expect(page.getByRole("status", { name: "Copy instructions status" }))
        .toHaveText("Copy failed");
});
