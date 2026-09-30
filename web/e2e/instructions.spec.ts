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
    await expect(page.locator("#chart-viewport canvas")).toHaveCount(1);
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

test("Crochet retains Pattern and Settings inspectors across the mode switch", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await bootApp(page);

    for (const name of ["Settings", "Pattern"] as const) {
        await page.getByRole("button", { name }).click();
        const inspector = page.getByRole("complementary", { name });
        await expect(inspector).toBeVisible();
        await page.locator("#btn-export").click();
        await expect(inspector).toBeVisible();
        await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "true");
        await page.locator("#btn-export").click();
        await expect(inspector).toBeVisible();
        await page.keyboard.press("Escape");
    }
});

test("Pattern palette edits refresh the open Crochet chart and yarn markers", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 2);
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 0, 1);
    await clickCell(page, 0, 8);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();

    const chartCell = await cellCoord(page, 0, 8);
    expect(await pixelRGB(page, chartCell.cx, chartCell.cy)).toEqual([0, 0, 0]);

    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#color-a").evaluate((input: HTMLInputElement) => {
        input.value = "#123456";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#accent-color").evaluate((input: HTMLInputElement) => {
        input.value = "#00ff00";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await page.locator("#danger-color").evaluate((input: HTMLInputElement) => {
        input.value = "#ff00ff";
        input.dispatchEvent(new Event("input", { bubbles: true }));
    });

    await expect(page.locator('.instructions-unit[aria-label="Row 1, Yarn A"] .instructions-unit-number'))
        .toHaveCSS("background-color", "rgb(18, 52, 86)");
    expect(await pixelRGB(page, chartCell.cx, chartCell.cy)).toEqual([18, 52, 86]);
    await page.locator('.instructions-unit[aria-label^="Row 9, Yarn A"]').click();
    const palettePixels = await page.locator("#canvas").evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let accent = 0;
        let danger = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] === 0 && pixels[i + 1] === 255 && pixels[i + 2] === 0) accent++;
            if (pixels[i] === 255 && pixels[i + 1] === 0 && pixels[i + 2] === 255) danger++;
        }
        return { accent, danger };
    });
    expect(palettePixels.accent).toBeGreaterThan(0);
    expect(palettePixels.danger).toBeGreaterThan(0);
});

test("Fit uses the whole canvas width while an inspector is open", async ({ page }) => {
    await page.setViewportSize({ width: 1600, height: 900 });
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.getByRole("button", { name: "Fit view" }).click();

    const centres = await page.evaluate(() => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const matrix = window.__test_matrix__!;
        const pattern = matrix.transformPoint({ x: 4.5, y: 4.5 });
        const dpr = window.devicePixelRatio || 1;
        return { canvas: rect.width / 2, pattern: pattern.x / dpr };
    });
    expect(centres.pattern).toBeCloseTo(centres.canvas, 1);
});

test("showing numbers rerenders without changing the view", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Settings" }).click();
    const before = await page.evaluate(() => {
        const m = window.__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    await page.getByText("Show numbers", { exact: true }).click();
    await page.getByText("Show numbers", { exact: true }).click();
    const after = await page.evaluate(() => {
        const m = window.__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    expect(after).toEqual(before);
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
    await expect(page.locator("#status-selection")).toBeVisible();
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
    await expect(crochet).toHaveText("Begin Crocheting");
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
    await expect(invalidUnit).toHaveClass(/instructions-unit--current-invalid/);
    await expect(invalidUnit).toHaveCSS("box-shadow", /rgb\(255, 0, 0\)/);
    const invalidGlyphs = await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: {
            invalidGlyphCoords: Array<{ x: number; y: number }>;
        } }).__test_instruction_guidance__?.invalidGlyphCoords ?? []);
    expect(invalidGlyphs.length).toBeGreaterThan(0);
    expect(invalidGlyphs.every(({ x, y }) => x >= 0 && x < 9 && y >= 0 && y < 9)).toBe(true);
    expect(await page.evaluate(() =>
        (window as typeof window & { __test_instruction_error_coords__?: Array<{ x: number; y: number }> })
            .__test_instruction_error_coords__ ?? [])).toEqual([{ x: 0, y: 0 }]);
});

for (const mode of ["row", "round"] as const) {
    test(`a top-edge ${mode} warning renders in the outward gutter and clears its support`, async ({ page }) => {
        if (mode === "row") await page.setViewportSize({ width: 852, height: 393 });
        await bootApp(page);
        const width = mode === "row" ? 3 : 9;
        const x = Math.floor(width / 2);
        const pixels = mode === "row"
            ? [1, 2, 1, 2, 2, 2, 1, 1, 1]
            : Array.from({ length: width * width }, (_, index) => {
                const px = index % width, py = Math.floor(index / width);
                const ring = Math.min(px, py, width - 1 - px, width - 1 - py);
                return ring >= 3 ? 0 : ring % 2 + 1;
            });
        pixels[x] = 2;
        const chooserPromise = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Open" }).click();
        await (await chooserPromise).setFiles({
            name: `top-edge-invalid-${mode}.mcw`,
            mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({
                version: 1,
                state: mode === "row"
                    ? { mode, canvasWidth: width, canvasHeight: width }
                    : { mode, canvasWidth: width, canvasHeight: width,
                        virtualWidth: width, virtualHeight: width, offsetX: 0, offsetY: 0, rounds: 3 },
                pixels, colorA: "#000000", colorB: "#ffffff",
            })),
        });
        await expect(page.getByRole("button", { name: "Begin Crocheting — 1 invalid stitch" })).toBeVisible();
        if (mode === "round") {
            await page.keyboard.press("r");
            await page.keyboard.press("r");
            await expect.poll(() => page.evaluate(() => Math.abs(window.__test_matrix__!.a))).toBeLessThan(0.001);
        }
        const outward = await cellCoord(page, x, -1);
        expect(await pixelRGB(page, outward.cx, outward.cy)).toEqual([255, 0, 0]);
        const cellSize = await page.evaluate(() => {
            const matrix = window.__test_matrix__!;
            return Math.hypot(matrix.a, matrix.b) / window.devicePixelRatio;
        });
        const canvas = await page.locator("#canvas").boundingBox();
        expect(outward.cy - cellSize * 0.37).toBeGreaterThanOrEqual(canvas!.y);
        expect(outward.cy + cellSize * 0.37).toBeLessThanOrEqual(canvas!.y + canvas!.height);
        expect(await pixelRGB(page, outward.cx, outward.cy + cellSize * 0.28)).toEqual([255, 0, 0]);
        const support = await cellCoord(page, x, 0);
        expect(await pixelRGB(page, support.cx, support.cy)).toEqual([255, 255, 255]);

        await page.getByRole("button", { name: "Clear overlay" }).click();
        await clickCell(page, x, -1);
        await expect(page.getByRole("button", { name: "Begin Crocheting", exact: true })).toBeVisible();
        expect(await pixelRGB(page, support.cx, support.cy)).toEqual([0, 0, 0]);
        expect(await pixelRGB(page, outward.cx, outward.cy)).not.toEqual([255, 0, 0]);
    });
}

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
    await expect(first.locator(".instructions-unit-number")).toHaveText("1");
    await expect(second.locator(".instructions-unit-number")).toHaveText("2");
    await expect(first.locator(".instructions-unit-number")).not.toHaveAttribute("aria-hidden");
    const marker = await first.locator(".instructions-unit-number").boundingBox();
    const button = await first.boundingBox();
    expect(marker!.height).toBe(button!.height);
    expect(marker!.width).toBe(marker!.height);
    await expect(first.locator("code")).toHaveCSS("white-space", "nowrap");
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

test("Crochet canvas arrow follows the current unit's alternate direction", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]').click();
    const forward = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward).toHaveLength(1);
    expect(forward![0].invalid).toBe(false);

    await page.getByText("Alternate direction", { exact: true }).click();
    const alternate = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward![0].nextX).toBeGreaterThan(forward![0].x);
    expect(alternate![0].nextX).toBeLessThan(alternate![0].x);
    expect(alternate![0].y).toBe(forward![0].y);
});

test("Crochet shows only the current unit's start arrow", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    expect(await page.evaluate(() => window.__test_instruction_starts__)).toHaveLength(1);
    const first = (await page.evaluate(() => window.__test_instruction_starts__))![0];
    await page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]').click();
    const second = await page.evaluate(() => window.__test_instruction_starts__);
    expect(second).toHaveLength(1);
    expect(second![0].y).not.toBe(first.y);
});

test("long Crochet instructions keep a full-height square yarn number and readable current text", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("50");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    for (const x of [0, 2, 3, 6, 9, 10, 13, 15, 18, 19, 22, 25, 27, 28, 31, 34, 35, 38, 41, 43, 46, 49]) {
        await clickCell(page, x, 8);
    }
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const row = page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]');
    await row.click();
    expect((await row.locator("code").textContent())!.length).toBeGreaterThan(60);
    const marker = await row.locator(".instructions-unit-number").boundingBox();
    const button = await row.boundingBox();
    expect(marker!.height).toBeCloseTo(button!.height, 0);
    expect(marker!.width).toBeCloseTo(marker!.height, 0);
    await expect(row.locator("code")).toHaveCSS("white-space", "nowrap");
    await expect(page.locator("#instructions-current-text")).toHaveText(await row.locator("code").textContent() ?? "");
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    const enlargedMarker = await row.locator(".instructions-unit-number").boundingBox();
    const enlargedButton = await row.boundingBox();
    const enlargedText = await row.locator("code").boundingBox();
    expect(enlargedMarker!.width).toBeCloseTo(enlargedMarker!.height, 0);
    expect(enlargedMarker!.height).toBeCloseTo(enlargedButton!.height, 0);
    expect(enlargedText!.height).toBeLessThanOrEqual(enlargedButton!.height);
});

test("the current row arrow stays inside the chart beside nearby row numbers", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const lane = async () => page.evaluate(() => {
        const edge = window.__test_matrix__!.transformPoint({ x: 0, y: 0 }).x;
        const arrow = (window as typeof window & { __test_instruction_arrow_geometry__?: Array<{
            bounds: { left: number; right: number };
        }> }).__test_instruction_arrow_geometry__![0];
        return { edge, arrow };
    });
    const first = await lane();
    expect(first.arrow.bounds.left).toBeGreaterThanOrEqual(first.edge);
    await page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]').click();
    await page.getByText("Alternate direction", { exact: true }).click();
    const second = await lane();
    expect(second.arrow.bounds.left).toBeGreaterThanOrEqual(second.edge);
});

test("Crochet outlines the current row on the chart", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const edge = async () => page.evaluate(() =>
        (window as typeof window & { __test_instruction_boundary_paths__?: number[][] })
            .__test_instruction_boundary_paths__ ?? []);
    const first = await edge();
    expect(first.length).toBeGreaterThan(0);
    expect([...new Set(first.flat().filter((_, index) => index % 2 === 1))].sort())
        .toEqual([8, 9]);
    await page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]').click();
    const second = await edge();
    expect(second.length).toBeGreaterThan(0);
    expect([...new Set(second.flat().filter((_, index) => index % 2 === 1))].sort())
        .toEqual([7, 8]);
    expect(second).not.toEqual(first);
});

test("the current round edge and arrow follow the same chart ring", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-rounds").fill("2");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const geometry = async () => page.evaluate(() => ({
        arrows: window.__test_instruction_starts__ ?? [],
        paths: (window as typeof window & { __test_instruction_boundary_paths__?: number[][] })
            .__test_instruction_boundary_paths__ ?? [],
    }));
    const first = await geometry();
    expect(first.arrows).toHaveLength(1);
    expect(first.paths.length).toBeGreaterThan(0);
    await page.locator('.instructions-unit[aria-label^="Round 2,"]').click();
    const second = await geometry();
    expect(second.arrows).toHaveLength(1);
    expect(second.paths).not.toEqual(first.paths);
    const xs = second.paths.flat().filter((_, index) => index % 2 === 0);
    const ys = second.paths.flat().filter((_, index) => index % 2 === 1);
    expect(second.arrows[0].x + 0.5).toBeGreaterThan(Math.min(...xs));
    expect(second.arrows[0].x + 0.5).toBeLessThan(Math.max(...xs));
    expect(second.arrows[0].y + 0.5).toBeGreaterThan(Math.min(...ys));
    expect(second.arrows[0].y + 0.5).toBeLessThan(Math.max(...ys));
});

test("the final round keeps its edge and arrow while showing full-chart guidance", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-rounds").fill("3");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.locator("#instructions-units .instructions-unit").last().click();
    const state = await page.evaluate(() => ({
        filtered: (window as typeof window & { __test_instruction_guidance__?: { filtered: boolean } })
            .__test_instruction_guidance__?.filtered,
        arrows: window.__test_instruction_starts__?.length,
        paths: (window as typeof window & { __test_instruction_boundary_paths__?: number[][] })
            .__test_instruction_boundary_paths__?.length,
    }));
    expect(state.filtered).toBe(false);
    expect(state.arrows).toBe(1);
    expect(state.paths).toBeGreaterThan(0);
});

test("Crochet canvas arrows sit before and point into their first stitch", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const geometry = await page.evaluate(() =>
        (window as typeof window & { __test_instruction_arrow_geometry__?: Array<{
            startCentre: { x: number; y: number };
            shaft: { x: number; y: number };
            tip: { x: number; y: number };
            direction: { x: number; y: number };
        }> }).__test_instruction_arrow_geometry__?.[0]);
    expect(geometry).toBeTruthy();
    const project = (point: { x: number; y: number }) =>
        point.x * geometry!.direction.x + point.y * geometry!.direction.y;
    expect(project(geometry!.shaft)).toBeLessThan(project(geometry!.tip));
    expect(project(geometry!.tip)).toBeLessThan(project(geometry!.startCentre));
});

test("Crochet canvas arrows stay visible and rotate with the chart", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-height").fill("1");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();

    const arrowGeometry = async () => page.evaluate(() => {
            const geometry = (window as typeof window & { __test_instruction_arrow_geometry__?: Array<{
                shaft: { x: number; y: number }; tip: { x: number; y: number };
                direction: { x: number; y: number };
            }> }).__test_instruction_arrow_geometry__?.[0];
            if (!geometry) throw new Error("instruction arrow hook missing");
            const canvas = document.getElementById("canvas") as HTMLCanvasElement;
            return { ...geometry, width: canvas.width, height: canvas.height };
        });

    const before = await arrowGeometry();
    expect(Math.abs(before.direction.x)).toBeGreaterThan(Math.abs(before.direction.y));
    expect([before.shaft, before.tip].some(point =>
        point.x >= 0 && point.x <= before.width && point.y >= 0 && point.y <= before.height)).toBe(true);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    const after = await arrowGeometry();
    expect(Math.abs(after.direction.y)).toBeGreaterThan(Math.abs(after.direction.x));
    expect([after.shaft, after.tip].some(point =>
        point.x >= 0 && point.x <= after.width && point.y >= 0 && point.y <= after.height)).toBe(true);
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

test("partial-round start arrows do not overlap their number lane", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Quarter", { exact: true }).click();
    await page.locator("#edit-rounds").fill("3");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();

    const expectClearance = async () => {
        const geometry = await page.evaluate(() => {
            const canvas = document.getElementById("canvas") as HTMLCanvasElement;
            return {
                width: canvas.width,
                height: canvas.height,
                arrows: (window as typeof window & { __test_instruction_arrow_geometry__?: Array<{
                    bounds: { left: number; top: number; right: number; bottom: number };
                }> }).__test_instruction_arrow_geometry__ ?? [],
                labels: (window as typeof window & { __test_instruction_label_geometry__?: Array<{
                    bounds: { left: number; top: number; right: number; bottom: number };
                }> }).__test_instruction_label_geometry__ ?? [],
            };
        });
        expect(geometry.arrows).toHaveLength(1);
        expect(geometry.labels).toHaveLength(3);
        for (const arrow of geometry.arrows) {
            expect(arrow.bounds.left).toBeGreaterThanOrEqual(0);
            expect(arrow.bounds.top).toBeGreaterThanOrEqual(0);
            expect(arrow.bounds.right).toBeLessThanOrEqual(geometry.width);
            expect(arrow.bounds.bottom).toBeLessThanOrEqual(geometry.height);
            for (const label of geometry.labels) {
                const horizontalGap = Math.max(label.bounds.left - arrow.bounds.right, arrow.bounds.left - label.bounds.right, 0);
                const verticalGap = Math.max(label.bounds.top - arrow.bounds.bottom, arrow.bounds.top - label.bounds.bottom, 0);
                expect(Math.hypot(horizontalGap, verticalGap)).toBeGreaterThanOrEqual(2);
            }
        }
    };
    await expectClearance();
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    await expectClearance();
});

test("round arrows follow Alternate direction", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-rounds").fill("2");

    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const forward = await page.evaluate(() => window.__test_instruction_starts__);
    expect(forward).toHaveLength(1);

    await page.locator('.instructions-unit[aria-label^="Round 2,"]').click();
    const round2Forward = await page.evaluate(() => window.__test_instruction_starts__);
    expect(round2Forward).toHaveLength(1);

    await page.getByText("Alternate direction", { exact: true }).click();
    const alternate = await page.evaluate(() => window.__test_instruction_starts__);
    expect(alternate).toHaveLength(1);
    expect(alternate![0]).not.toMatchObject({
        x: round2Forward![0].x, y: round2Forward![0].y,
        nextX: round2Forward![0].nextX, nextY: round2Forward![0].nextY,
    });
});

test("Crochet renders through the current row and no future rows", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 4, 8);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    expect(await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: { filtered: boolean } })
            .__test_instruction_guidance__?.filtered)).toBe(true);
    const rowCount = await page.locator("#instructions-units .instructions-unit").count();
    await page.getByRole("button", { name: "Fit view" }).click();
    const currentRow1 = await cellCoord(page, 4, rowCount - 1);
    const futureRow2 = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, futureRow2.cx, futureRow2.cy)).toEqual([22, 22, 24]);
    expect(await pixelRGB(page, currentRow1.cx, currentRow1.cy)).not.toEqual([22, 22, 24]);

    await page.getByRole("button", { name: "Forward one row" }).click();
    const currentGuidance = await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: {
            validGlyphCoords: Array<{ x: number; y: number }>;
            invalidGlyphCoords: Array<{ x: number; y: number }>;
        } }).__test_instruction_guidance__);
    expect(currentGuidance!.validGlyphCoords).toContainEqual({ x: 4, y: 7 });
    expect([...currentGuidance!.validGlyphCoords, ...currentGuidance!.invalidGlyphCoords]
        .every(({ y }) => y === 7)).toBe(true);
    const completedRow1 = await cellCoord(page, 4, rowCount - 1);
    expect(await pixelRGB(page, completedRow1.cx, completedRow1.cy)).not.toEqual([22, 22, 24]);
    const currentRow2 = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, currentRow2.cx, currentRow2.cy)).not.toEqual([22, 22, 24]);

    await page.getByRole("button", { name: "Back one row" }).click();
    const futureAgain = await cellCoord(page, 4, rowCount - 2);
    expect(await pixelRGB(page, futureAgain.cx, futureAgain.cy)).toEqual([22, 22, 24]);

    await page.locator("#instructions-units .instructions-unit").last().click();
    expect(await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: { filtered: boolean } })
            .__test_instruction_guidance__?.filtered)).toBe(false);
});

test("Crochet shows current-round guidance before the final round", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-rounds").fill("3");
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 2, 4);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.getByRole("button", { name: "Forward one round" }).click();

    const guidance = await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: {
            validGlyphCoords: Array<{ x: number; y: number }>;
            invalidGlyphCoords: Array<{ x: number; y: number }>;
        } }).__test_instruction_guidance__);
    expect(guidance!.validGlyphCoords).toContainEqual({ x: 1, y: 4 });
    expect([...guidance!.validGlyphCoords, ...guidance!.invalidGlyphCoords]
        .every(({ x, y }) => Math.min(x, y, 8 - x, 8 - y) === 1)).toBe(true);
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
    let copied = "";
    await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
            configurable: true,
            value: { writeText: async (text: string) => {
                (window as typeof window & { __copied?: string }).__copied = text;
            } },
        });
    });
    await bootApp(page);
    await page.locator("#btn-export").click();
    const status = page.getByRole("status", { name: "Copy instructions status" });
    await expect(page.getByRole("button", { name: "Copy instructions" })).toHaveText("");

    await page.getByRole("button", { name: "Copy instructions" }).click();
    await expect(status).toHaveText("Copied");
    copied = await page.evaluate(() => (window as typeof window & { __copied?: string }).__copied ?? "");
    expect(copied.split("\n")[0]).toMatch(/^Row 1 · Yarn A: /);
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
