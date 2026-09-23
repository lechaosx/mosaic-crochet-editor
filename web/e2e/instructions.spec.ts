import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB } from "./_helpers";

test("a crocheter gets a focused workspace while the global document bar stays available", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await bootApp(page);
    await clickCell(page, 0, 1);
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
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

    await expect(page.getByRole("button", { name: "Begin Crocheting" })).toBeVisible();
    await page.getByRole("button", { name: "Begin Crocheting" }).click();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeFocused();
    await expect(page.getByRole("button", { name: "Back to Design" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Pattern" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
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

    await page.getByRole("button", { name: "Back to Design" }).click();
    await expect(page.locator(".canvas-area")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Begin Crocheting" })).toBeFocused();
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
    const designZoom = await page.evaluate(() => window.__test_matrix__!.a);
    const designCell = await cellCoord(page, 1, 1);
    const designPixel = await pixelRGB(page, designCell.cx, designCell.cy);

    await page.locator("#btn-export").click();
    await expect(page.locator(".canvas-area #canvas")).toBeVisible();
    expect(await page.evaluate(() => window.__test_matrix__!.a)).toBeCloseTo(designZoom, 4);
    await page.getByRole("button", { name: "Zoom in" }).click();
    const crochetZoom = await page.evaluate(() => window.__test_matrix__!.a);
    expect(crochetZoom).toBeGreaterThan(designZoom);
    await clickCell(page, 1, 1);

    await page.locator("#btn-export").click();

    await expect(page.locator(".canvas-area > #chart-viewport > #canvas")).toBeVisible();
    expect(await page.evaluate(() => window.__test_matrix__!.a)).toBeCloseTo(crochetZoom, 4);
    const returnedCell = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, returnedCell.cx, returnedCell.cy)).toEqual(designPixel);
});

test("Crochet keeps the orientation reset control operable", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);

    const orientation = page.locator("#view-rotation-reset");
    await expect(orientation).toHaveAccessibleName("Reset view orientation from 45°");
    await expect(orientation).toBeVisible();
    await orientation.click();
    await page.waitForTimeout(300);
    await expect(orientation).toHaveAccessibleName("Reset view orientation");
});

test("workspace switch remains direct in the compact toolbar", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    const canvasBefore = await page.locator(".canvas-area").boundingBox();
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Menu" })).toBeVisible();
    expect(await page.locator(".canvas-area").boundingBox()).toEqual(canvasBefore);
    await page.locator("#btn-export").click();
    await expect(page.locator("#btn-export")).toBeFocused();
});

test("only document-changing commands leave Crochet", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    const edited = await cellCoord(page, 1, 1);

    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    expect(await pixelRGB(page, edited.cx, edited.cy)).toEqual([255, 255, 255]);

    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Redo" }).click();
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    expect(await pixelRGB(page, edited.cx, edited.cy)).toEqual([0, 0, 0]);

    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.locator("#hl-popover")).toBeVisible();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeVisible();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();

    await page.getByRole("spinbutton", { name: "Width", exact: true }).fill("10");
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeHidden();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
});

test("switching workspaces does not move selected Design content", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.keyboard.press("Control+a");

    await page.locator("#btn-export").click();
    await page.locator("#btn-export").click();
    await page.keyboard.press("Escape");

    const original = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, original.cx, original.cy)).toEqual([0, 0, 0]);
});

test("Design shortcuts are inert while Crochet is open", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);

    await page.locator("#btn-export").click();
    await page.keyboard.press("p");
    await page.keyboard.press("Escape");
    await page.locator("#btn-export").click();

    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: /selected/ })).toBeVisible();
});

test("reselecting Crochet preserves its current line", async ({ page }) => {
    await bootApp(page);
    const crochet = page.locator("#btn-export");
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

    const crochet = page.getByRole("button", { name: "Begin Crocheting — 1 invalid stitch" });
    await expect(crochet).toContainText("!");
    await expect(crochet).toHaveClass(/btn--danger/);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("status", { name: "Crochet errors" })).toHaveText("1 error");
    await expect(page.locator('.instructions-unit[aria-label="Row 8, Yarn B"]')).toContainText("oc");
    const invalidUnit = page.locator('.instructions-unit[aria-label^="Row 9, Yarn A"]');
    await expect(invalidUnit).toContainText("oc");
    await expect(invalidUnit).toHaveClass(/instructions-unit--invalid/);
    await expect(invalidUnit).toHaveAccessibleName(/contains invalid stitches/);
    await expect(invalidUnit.locator(".instructions-unit-number")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await expect(page.getByLabel("Instruction blockers")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
    await invalidUnit.click();
    await expect(invalidUnit).toHaveCSS("box-shadow", /rgb\(255, 116, 116\)/);
});

test("Crochet advances by whole rows and resumes the exact instruction plan", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);

    await page.locator("#btn-export").click();
    await expect(page.getByRole("img", { name: "Crochet progress chart" })).toBeVisible();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Back one row" })).toBeDisabled();

    await page.getByRole("button", { name: "Forward one row" }).click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");
    await expect(page.getByRole("button", { name: "Back one row" })).toBeEnabled();

    await page.locator("#btn-export").click();
    await page.locator("#btn-export").click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");

    await page.locator("#btn-export").click();
    await clickCell(page, 1, 1);
    await page.locator("#btn-export").click();
    await expect(page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]')).toHaveAttribute("aria-current", "step");

    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("10");
    await expect(page.getByRole("button", { name: "Begin Crocheting" })).toBeVisible();
    await page.locator("#btn-export").click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toContainText("sc × 10");

    await page.locator("#btn-export").click();
    await page.locator("#edit-width").fill("9");
    await page.locator("#btn-export").click();
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
    await page.locator("#btn-export").click();

    const first = page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]');
    const second = page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]');
    const third = page.locator('.instructions-unit[aria-label="Row 3, Yarn A"]');
    await expect(first).not.toContainText("Row");
    await expect(first).not.toContainText("Yarn");
    await expect(first.locator(".instructions-unit-number")).toHaveText("1");
    await expect(first.locator(".instructions-unit-number")).toHaveCSS("background-color", "rgb(18, 52, 86)");
    await expect(second.locator(".instructions-unit-number")).toHaveCSS("background-color", "rgb(171, 205, 239)");
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
    await page.locator("#btn-export").click();
    const copy = page.getByRole("button", { name: "Copy instructions" });
    await expect(copy).toBeEnabled();

    await page.getByText("Alternate direction", { exact: true }).click();

    await expect(copy).toBeEnabled();
    await expect(page.locator("#export-progress")).toBeHidden();
});

test("generation progress does not reframe the Crochet list when it clears", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-height").fill("80");
    await expect(page.getByRole("button", { name: "Begin Crocheting" })).toBeVisible();

    await page.locator("#btn-export").click();
    await expect(page.locator("#export-progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeDisabled();
    const whileGenerating = await page.locator("#instructions-units").boundingBox();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const complete = await page.locator("#instructions-units").boundingBox();
    expect(complete).toEqual(whileGenerating);
});

test("Crochet can return to Design during a long generation", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-height").fill("80");
    await page.locator("#btn-export").click();
    await expect(page.locator("#export-progress")).toBeVisible();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeDisabled();

    await page.locator("#btn-export").click();
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeHidden();
    await expect(page.getByRole("button", { name: "Begin Crocheting" })).toBeVisible();
});

test("a loaded empty round remains a single progress unit", async ({ page }) => {
    await bootApp(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open" }).click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "empty-round.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 1,
            state: {
                mode: "round", canvasWidth: 1, canvasHeight: 1,
                virtualWidth: 3, virtualHeight: 3, offsetX: 1, offsetY: 1, rounds: 1,
            },
            pixels: [0], colorA: "#000000", colorB: "#ffffff",
        })),
    });

    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await expect(page.locator('.instructions-unit[aria-label="Round 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await expect(page.locator("#instructions-units .instructions-unit")).toHaveCount(1);
    await expect(page.locator("#instructions-live-progress")).toHaveText("1 / 1");
    await expect(page.getByRole("button", { name: "Forward one round" })).toBeDisabled();
});

test("a local cache scan can cancel at its periodic yield", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-height").fill("80");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.locator("#btn-export").click();
    const before = await cellCoord(page, 0, 1);
    const beforePixel = await pixelRGB(page, before.cx, before.cy);
    await page.getByRole("button", {
        name: beforePixel[0] < 128 ? "Yarn B" : "Yarn A",
        exact: true,
    }).click();
    await clickCell(page, 0, 1);
    const after = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, after.cx, after.cy)).not.toEqual(beforePixel);
    await page.evaluate(() => {
        window.__test_instruction_yields__ = [];
        window.__test_on_instruction_yield__ = yielded => {
            if (yielded.index === 63 && !yielded.recomputed) {
                document.getElementById("btn-export")!.click();
            }
        };
    });

    await page.locator("#btn-export").click();
    await expect.poll(() => page.evaluate(() => window.__test_instruction_yields__))
        .toContainEqual({ index: 63, recomputed: false });
    await expect(page.getByRole("complementary", { name: "Crochet" })).toBeHidden();
});

test("Crochet canvas arrows start every unit in its actual alternate direction", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const forward = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward).toHaveLength(9);
    expect(forward![1].invalid).toBe(false);

    await page.getByText("Alternate direction", { exact: true }).click();
    const alternate = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward![1].nextX).toBeGreaterThan(forward![1].x);
    expect(alternate![1].nextX).toBeLessThan(alternate![1].x);
    expect(alternate![1].y).toBe(forward![1].y);
});

test("Crochet canvas arrows stay visible and rotate with the chart", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-height").fill("1");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();

    const accentBounds = async () => {
        const start = await page.evaluate(() => window.__test_instruction_starts__?.[0]);
        if (!start) throw new Error("instruction arrow hook missing");
        const centre = await cellCoord(page, start.x, start.y);
        return page.evaluate(({ cx, cy }) => {
            const canvas = document.getElementById("canvas") as HTMLCanvasElement;
            const rect = canvas.getBoundingClientRect();
            const dpr = window.devicePixelRatio || 1;
            const left = Math.max(0, Math.round((cx - rect.left) * dpr) - 24);
            const top = Math.max(0, Math.round((cy - rect.top) * dpr) - 24);
            const width = Math.min(49, canvas.width - left), height = Math.min(49, canvas.height - top);
            const pixels = canvas.getContext("2d", { willReadFrequently: true })!
                .getImageData(left, top, width, height).data;
            let minX = width, minY = height, maxX = -1, maxY = -1;
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > 160 && pixels[i + 2] > 120 && pixels[i] - pixels[i + 1] > 50) {
                    const pixel = i / 4;
                    const x = pixel % width, y = Math.floor(pixel / width);
                    minX = Math.min(minX, x); minY = Math.min(minY, y);
                    maxX = Math.max(maxX, x); maxY = Math.max(maxY, y);
                }
            }
            return { width: maxX - minX + 1, height: maxY - minY + 1 };
        }, centre);
    };

    const before = await accentBounds();
    expect(before.width).toBeGreaterThan(before.height);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    const after = await accentBounds();
    expect(after.height).toBeGreaterThan(after.width);
});

test("a one-cell quarter round has a canvas start arrow", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Quarter", { exact: true }).click();
    await page.locator("#edit-inner-width").fill("0");
    await page.locator("#edit-inner-height").fill("0");
    await page.locator("#edit-rounds").fill("1");

    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const forward = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward).toHaveLength(1);
    expect(forward![0].nextX === forward![0].x && forward![0].nextY === forward![0].y).toBe(false);
});

test("round arrows follow Alternate direction", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-rounds").fill("2");

    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const forward = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward).toHaveLength(2);

    await page.getByText("Alternate direction", { exact: true }).click();
    const alternate = await page.evaluate(() => window.__test_instruction_starts__);
    expect(alternate).toHaveLength(2);
    expect(alternate![1]).not.toMatchObject({
        x: forward![1].x, y: forward![1].y,
        nextX: forward![1].nextX, nextY: forward![1].nextY,
    });
});

test("Crochet renders through the current row and no future rows", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
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

    await page.locator("#btn-export").click();
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

    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Forward one row" }).click();

    await expect(page.getByRole("alert"))
        .toHaveText("Progress not saved");
    await page.locator("#btn-export").click();
    await page.locator("#btn-export").click();
    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
});

test("Crochet keeps a single Centre-out round at both progress limits", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByLabel("Rounds").fill("1");

    await page.locator("#btn-export").click();
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
    await page.locator("#btn-export").click();
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
    await page.locator("#btn-export").click();

    await page.getByRole("button", { name: "Copy instructions" }).click();
    await expect(page.getByRole("status", { name: "Copy instructions status" }))
        .toHaveText("Copy failed");
});
