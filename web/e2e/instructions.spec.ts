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
    await expect(page.getByLabel("Canvas context")).toBeVisible();
    await expect(page.getByText("Alternate direction", { exact: true })).toBeHidden();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeHidden();
    await page.evaluate(() => {
        (window as typeof window & { __designCanvas?: HTMLCanvasElement }).__designCanvas =
            document.getElementById("canvas") as HTMLCanvasElement;
    });
    const designViewport = await page.locator("#chart-viewport").boundingBox();

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Crochet", level: 1 })).toBeFocused();
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Crochet" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Load" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save .mcw" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Undo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Redo" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Settings" })).toBeVisible();
    await expect(page.getByRole("status", { name: "Browser recovery" })).toBeVisible();
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
    await expect(page.getByLabel("Canvas context")).toBeVisible();
    const painted = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, painted.cx, painted.cy)).toEqual([0, 0, 0]);
});

test("Crochet preserves and controls the shared chart viewport", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Invert" }).click();
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

test("global authoring commands return a crocheter to Design before opening their context", async ({ page }) => {
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
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeHidden();
    await expect(page.locator("#hl-popover")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeVisible();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Crochet" }).click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.getByRole("button", { name: "Design" })).toHaveAttribute("aria-pressed", "true");
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
    await page.getByRole("button", { name: "Done with Row 1" }).click();
    await crochet.click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn A"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet links blockers and labels unresolved instructions as a draft", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByText("Draft — 1 unresolved overlay position")).toBeVisible();
    const issue = page.getByRole("button", { name: "Focus unresolved overlay at 0, 0" });
    await expect(issue).toBeVisible();
    await issue.click();
    await expect(issue).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
});

test("Crochet advances by whole rows and resumes the exact instruction plan", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("img", { name: "Crochet progress chart" })).toBeVisible();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn B"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Back one row" })).toBeDisabled();

    await page.getByRole("button", { name: "Done with Row 1" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Back one row" })).toBeEnabled();

    await page.getByRole("button", { name: "Design" }).click();
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn A"]')).toHaveAttribute("aria-current", "step");

    await page.getByRole("button", { name: "Design" }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn B"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet renders through the current row and no future rows", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const rowCount = await page.locator("#instructions-units .instructions-unit").count();
    await page.getByRole("button", { name: "Fit view" }).click();
    const currentRow1 = await cellCoord(page, 4, rowCount - 1);
    const futureRow2 = await cellCoord(page, 4, rowCount - 2);
    const foundation = await cellCoord(page, 4, rowCount);
    expect(await pixelRGB(page, futureRow2.cx, futureRow2.cy)).toEqual([22, 22, 24]);
    expect(await pixelRGB(page, currentRow1.cx, currentRow1.cy)).toEqual([255, 255, 255]);
    expect(await pixelRGB(page, foundation.cx, foundation.cy)).not.toEqual([22, 22, 24]);

    await page.getByRole("button", { name: "Done with Row 1" }).click();
    const completedRow1 = await cellCoord(page, 4, rowCount - 1);
    expect(await pixelRGB(page, completedRow1.cx, completedRow1.cy)).toEqual([255, 255, 255]);
    const currentRow2 = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, currentRow2.cx, currentRow2.cy)).not.toEqual([22, 22, 24]);

    await page.getByRole("button", { name: "Back one row" }).click();
    const futureAgain = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, futureAgain.cx, futureAgain.cy)).toEqual([22, 22, 24]);
});

test("Crochet progress is unavailable while instruction blockers remain", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.getByRole("button", { name: "Done with Row 1" })).toBeDisabled();
    await expect(page.getByText("Resolve chart issues to track crochet progress.")).toBeVisible();
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
    await page.getByRole("button", { name: "Done with Row 1" }).click();

    await expect(page.getByRole("alert"))
        .toHaveText("Progress could not be saved locally. Keep this tab open to retain your place.");
    await page.getByRole("button", { name: "Design" }).click();
    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn B"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet completes and reopens a Centre-out round as one boundary", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByLabel("Rounds").fill("1");
    await page.getByRole("button", { name: "Start with a blank centre-out pattern" }).click();

    await page.getByRole("button", { name: "Crochet" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Round 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    const back = page.getByRole("button", { name: "Back one round" });
    await expect(back).toBeDisabled();

    await page.getByRole("button", { name: "Done with Round 1" }).click();
    await expect(page.getByRole("heading", { name: "Pattern complete" })).toBeFocused();
    await expect(page.locator("#instructions-live-progress")).toContainText("1 of 1 complete");
    await expect(back).toBeEnabled();
    await expect(page.getByRole("button", { name: /Done with/ })).toBeHidden();

    await back.click();
    await expect(page.locator('.instructions-unit[aria-label="Round 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
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

    await page.getByRole("button", { name: "Copy instructions" }).click();
    await expect(status).toHaveText("Instructions copied.");
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
        .toHaveText("Could not copy instructions.");
});
