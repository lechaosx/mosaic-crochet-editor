import { test, expect } from "@playwright/test";
import { bootApp, clickCell, cellCoord, pixelRGB, chooseToolVariant } from "./_helpers";

test("a crocheter gets a focused workspace while the global document bar stays available", async ({ page }) => {
    await page.setViewportSize({ width: 2200, height: 900 });
    await bootApp(page);
    await clickCell(page, 0, 1);
    await expect(page.getByRole("button", { name: "Pattern", exact: true })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Pattern", exact: true })).toBeVisible();
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
    await expect(page.getByRole("button", { name: "Pattern", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Navigate" })).toBeVisible();
    await expect(page.getByLabel("Canvas context")).toBeHidden();
    const painted = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, painted.cx, painted.cy)).toEqual([0, 0, 0]);
});

test("Crochet preserves and controls the shared chart viewport", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.getByRole("button", { name: "Invert" }).click();
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
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
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

    await page.getByRole("button", { name: "Pattern", exact: true }).click();
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
    const seamPixel = () => page.evaluate(() => {
        const triangle = window.__test_instruction_seam_geometry__!.screenTriangle;
        const x = triangle.reduce((sum, point) => sum + point[0], 0) / 3;
        const y = triangle.reduce((sum, point) => sum + point[1], 0) / 3;
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.round(x), Math.round(y), 1, 1).data).slice(0, 3);
    });
    expect(await seamPixel()).toEqual([0, 255, 0]);
    await page.locator('.instructions-unit[aria-label^="Row 9, Yarn A"]').click();
    expect(await seamPixel()).toEqual([255, 0, 255]);
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

    const crochet = page.getByRole("button", { name: "Begin Crocheting — 1 invalid placement" });
    await expect(crochet).toHaveText("Begin Crocheting");
    await expect(crochet).toHaveClass(/btn--danger/);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("status", { name: "Crochet errors" })).toHaveText("1 invalid placement");
    await expect(page.locator('.instructions-unit[aria-label="Row 8, Yarn B"]')).toContainText("oc");
    const invalidUnit = page.locator('.instructions-unit[aria-label^="Row 9, Yarn A"]');
    await expect(invalidUnit).toContainText("oc");
    await expect(invalidUnit).toHaveClass(/instructions-unit--invalid/);
    await expect(invalidUnit).toHaveAccessibleName(/contains invalid placements/);
    await expect(invalidUnit.locator(".instructions-unit-number")).toHaveCSS("background-color", "rgb(0, 0, 0)");
    await expect(page.getByLabel("Instruction blockers")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
    await invalidUnit.click();
    await expect(invalidUnit).toHaveClass(/instructions-unit--current-invalid/);
    expect(await invalidUnit.locator("code").evaluate(el => getComputedStyle(el, "::before").content)).toContain("!");
    const invalidGlyphs = await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: {
            invalidGlyphCoords: Array<{ x: number; y: number }>;
        } }).__test_instruction_guidance__?.invalidGlyphCoords ?? []);
    expect(invalidGlyphs.length).toBeGreaterThan(0);
    expect(invalidGlyphs.every(({ x, y }) => x >= 0 && x < 9 && y >= 0 && y < 9)).toBe(true);
    const warning = await cellCoord(page, 0, 0);
    expect(await pixelRGB(page, warning.cx, warning.cy)).toEqual([255, 0, 0]);
    const plainCell = await page.evaluate(() => {
        const point = window.__test_matrix__!.transformPoint({ x: 0.2, y: 0.2 });
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data).slice(0, 3);
    });
    expect(plainCell).toEqual([0, 0, 0]);
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
        if (!await page.locator("#btn-load").isVisible()) await page.locator("#btn-more").click();
        await page.locator("#btn-load").click();
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
        await expect(page.getByRole("button", { name: "Begin Crocheting — 1 invalid placement" })).toBeVisible();
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

        await chooseToolVariant(page, "Overlay", "Clear");
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
    await expect(page.getByRole("button", { name: "Back one row" })).toBeEnabled();

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
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();

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
    await expect(first).toBeVisible();
    const { marker, button } = await first.evaluate(item => ({
        marker: item.querySelector(".instructions-unit-number")!.getBoundingClientRect().toJSON(),
        button: item.getBoundingClientRect().toJSON(),
    }));
    expect(marker.height).toBeGreaterThan(0);
    expect(marker.height).toBe(button.height);
    expect(marker.width).toBe(marker.height);
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
    await expect(back).toBeEnabled();
    await page.locator('.instructions-unit[aria-label="Row 9, Yarn A"]').click();
    await expect(forward).toBeEnabled();
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
    await expect(page.locator('.instructions-unit[aria-label^="Round"]')).toHaveCount(1);
    await expect(page.getByRole("button", { name: "Whole pattern", exact: true })).toBeVisible();
    await expect(page.locator("#instructions-live-progress")).toHaveText("1 / 1");
    await page.getByRole("button", { name: "Forward one round" }).click();
    await expect(page.getByRole("button", { name: "Whole pattern", exact: true })).toHaveAttribute("aria-current", "step");
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

test("long Crochet instructions wrap between stitch counts beside a yarn number that fills the row height", async ({ page }) => {
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
    const instruction = (await row.locator("code").textContent())!;
    expect(instruction.length).toBeGreaterThan(60);
    expect(instruction).toContain("\u00a0×\u00a0");
    expect(instruction).not.toContain(" × ");
    expect(await page.locator("#instructions-current-text").textContent()).toBe(instruction);
    for (const [width, height, fontScale] of [[1600, 900, 100], [360, 900, 100], [844, 390, 100], [360, 900, 200]]) {
        await page.setViewportSize({ width, height });
        await page.addStyleTag({ content: `html { font-size: ${fontScale}%; }` });
        await row.scrollIntoViewIfNeeded();
        const layout = await row.evaluate(item => {
            const text = item.querySelector("code")!;
            const range = document.createRange();
            range.selectNodeContents(text);
            const marker = item.querySelector(".instructions-unit-number")!;
            return {
                marker: marker.getBoundingClientRect().toJSON(),
                shortMarker: document.querySelector(".instructions-unit-number")!.getBoundingClientRect().toJSON(),
                button: item.getBoundingClientRect().toJSON(),
                text: text.getBoundingClientRect().toJSON(),
                lines: Array.from(range.getClientRects(), rect => rect.toJSON()),
                stitchCounts: Array.from(text.textContent!.matchAll(/[a-z]+\u00a0×\u00a0\d+/g), match => {
                    const countRange = document.createRange();
                    countRange.setStart(text.firstChild!, match.index);
                    countRange.setEnd(text.firstChild!, match.index + match[0].length);
                    return Array.from(countRange.getClientRects(), rect => rect.toJSON());
                }),
                lineHeight: parseFloat(getComputedStyle(text).lineHeight),
                clientWidth: text.clientWidth, scrollWidth: text.scrollWidth,
                listWidth: document.getElementById("instructions-units")!.clientWidth,
            };
        });
        expect(layout.text.height).toBeGreaterThan(layout.lineHeight * 2);
        expect(layout.lines.length).toBeGreaterThan(1);
        expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
        expect(layout.button.width).toBeLessThanOrEqual(layout.listWidth);
        expect(layout.marker.height).toBeCloseTo(layout.button.height, 0);
        expect(layout.marker.height).toBeGreaterThan(layout.marker.width);
        expect(layout.marker.width).toBeCloseTo(layout.shortMarker.width, 0);
        expect(layout.marker.top).toBeCloseTo(layout.button.top, 0);
        expect(layout.marker.bottom).toBeCloseTo(layout.button.bottom, 0);
        expect(layout.stitchCounts.length).toBeGreaterThan(0);
        for (const count of layout.stitchCounts) {
            expect(count).toHaveLength(1);
        }
        for (const line of layout.lines) {
            expect(line.left).toBeGreaterThanOrEqual(layout.text.left);
            expect(line.right).toBeLessThanOrEqual(layout.text.right + 1);
            expect(line.top).toBeGreaterThanOrEqual(layout.button.top);
            expect(line.bottom).toBeLessThanOrEqual(layout.button.bottom);
        }
        await expect(row).toHaveAttribute("aria-current", "step");
        await page.getByRole("button", { name: "Forward one row" }).click();
        await expect(page.locator("#instructions-live-progress")).toHaveText("3 / 9");
        await page.getByRole("button", { name: "Back one row" }).click();
        await expect(row).toHaveAttribute("aria-current", "step");
        await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    }
});

test("Crochet marks only the current row's beginning seam", async ({ page }) => {
    await bootApp(page);
    const rowTopPixel = () => page.evaluate(() => {
        const point = window.__test_matrix__!.transformPoint({ x: 4.5, y: 8 });
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data);
    });
    const rowEndPixel = () => page.evaluate(() => {
        const point = window.__test_matrix__!.transformPoint({ x: 9, y: 8.5 });
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data).slice(0, 3);
    });
    const plainEnd = await rowEndPixel();
    const grid = await rowTopPixel();
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const crochetGrid = await rowTopPixel();
    for (let channel = 0; channel < 3; channel++) {
        expect(Math.abs(crochetGrid[channel] - grid[channel])).toBeLessThan(4);
    }
    expect(await rowEndPixel()).toEqual(plainEnd);
    const first = await page.evaluate(() => window.__test_instruction_seam_geometry__);
    expect(first!.edges).toEqual([[0, 8, 0, 9]]);
    expect(first!.triangle[0][0]).toBe(0);
    expect(first!.triangle[1][0]).toBe(0);
    expect(first!.triangle[2][0]).toBeGreaterThan(0);
    expect(first!.triangle[2][0]).toBeLessThan(1);
    await page.locator('.instructions-unit[aria-label="Row 2, Yarn B"]').click();
    expect((await page.evaluate(() => window.__test_instruction_seam_geometry__))!.edges)
        .toEqual([[0, 7, 0, 8]]);
    await page.getByText("Alternate direction", { exact: true }).click();
    const alternate = await page.evaluate(() => window.__test_instruction_seam_geometry__);
    expect(alternate!.edges).toEqual([[9, 7, 9, 8]]);
    expect(alternate!.triangle[0][0]).toBe(9);
    expect(alternate!.triangle[1][0]).toBe(9);
    expect(alternate!.triangle[2][0]).toBeLessThan(9);
    await page.getByRole("button", { name: "Back to Design" }).click();
    expect(await page.evaluate(() => window.__test_instruction_seam_geometry__)).toBeNull();
});

test("a complete round marks the shared seam and points into its first stitch", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-inner-width").fill("1");
    await page.locator("#edit-inner-height").fill("1");
    await page.locator("#edit-rounds").fill("3");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.locator('.instructions-unit[aria-label^="Round 3,"]').click();
    const seam = await page.evaluate(() => window.__test_instruction_seam_geometry__);
    expect(seam!.edges).toEqual([[2, 0, 2, 1]]);
    expect(seam!.triangle[0][0]).toBe(2);
    expect(seam!.triangle[1][0]).toBe(2);
    expect(seam!.triangle[2][0]).toBeGreaterThan(1);
    expect(seam!.triangle[2][0]).toBeLessThan(2);
    expect(await page.evaluate(() =>
        (window as typeof window & { __test_instruction_guidance__?: { filtered: boolean } })
            .__test_instruction_guidance__?.filtered)).toBe(true);
    await page.locator('.instructions-unit[aria-label^="Round 2,"]').click();
    await page.getByText("Alternate direction", { exact: true }).click();
    const reversed = await page.evaluate(() => window.__test_instruction_seam_geometry__);
    expect(reversed!.edges).toEqual([[3, 1, 3, 2]]);
    expect(reversed!.triangle[2][0]).toBeGreaterThan(3);
});

for (const extent of ["Half", "Quarter"]) {
    test(`${extent} rounds mark only the beginning seam`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Pattern" }).click();
        await page.getByText("Centre-out", { exact: true }).click();
        await page.getByText(extent, { exact: true }).click();
        await page.locator("#edit-inner-width").fill("1");
        await page.locator("#edit-inner-height").fill("1");
        await page.locator("#edit-rounds").fill("3");
        const endingPixel = () => page.evaluate((extent) => {
            const point = window.__test_matrix__!.transformPoint(extent === "Half"
                ? { x: 6.5, y: 0 } : { x: 4, y: 3.5 });
            const canvas = document.getElementById("canvas") as HTMLCanvasElement;
            return Array.from(canvas.getContext("2d")!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data).slice(0, 3);
        }, extent);
        const plainEnd = await endingPixel();
        await page.locator("#btn-export").click();
        await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
        await page.locator('.instructions-unit[aria-label^="Round 3,"]').click();
        const seam = await page.evaluate(() => window.__test_instruction_seam_geometry__);
        expect(await endingPixel()).toEqual(plainEnd);
        expect(seam!.edges).toEqual([[0, 0, 1, 0]]);
        expect(seam!.triangle[0][1]).toBe(0);
        expect(seam!.triangle[1][1]).toBe(0);
        expect(seam!.triangle[2][1]).toBeGreaterThan(0);
        expect(seam!.triangle[2][1]).toBeLessThan(1);
    });
}

test("the seam triangle rotates with its cell and is painted in the accent colour", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const geometry = () => page.evaluate(() => {
        const seam = window.__test_instruction_seam_geometry__!;
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const points = seam.screenTriangle;
        const x = points.reduce((sum, p) => sum + p[0], 0) / 3;
        const y = points.reduce((sum, p) => sum + p[1], 0) / 3;
        const colour = Array.from(canvas.getContext("2d")!.getImageData(Math.round(x), Math.round(y), 1, 1).data);
        const midX = (points[0][0] + points[1][0]) / 2;
        const midY = (points[0][1] + points[1][1]) / 2;
        return { colour, dx: points[2][0] - midX, dy: points[2][1] - midY, points,
            width: canvas.width, height: canvas.height,
            mappedBase: window.__test_matrix__!.transformPoint({ x: 0, y: 8.5 }).toJSON() };
    });
    const before = await geometry();
    expect(before.colour.slice(0, 3)).toEqual([214, 83, 163]);
    expect(before.dx).toBeGreaterThan(0);
    expect(before.dy).toBeCloseTo(0);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    const after = await geometry();
    expect(after.colour).toEqual(before.colour);
    expect(after.dy).toBeGreaterThan(0);
    expect(after.dx).toBeCloseTo(0);
    expect((after.points[0][0] + after.points[1][0]) / 2).toBeCloseTo(after.mappedBase.x);
    expect((after.points[0][1] + after.points[1][1]) / 2).toBeCloseTo(after.mappedBase.y);
    for (const point of after.points) {
        expect(point[0]).toBeGreaterThanOrEqual(0);
        expect(point[0]).toBeLessThanOrEqual(after.width);
        expect(point[1]).toBeGreaterThanOrEqual(0);
        expect(point[1]).toBeLessThanOrEqual(after.height);
    }
});

test("the triangle and seam have a continuous filled junction", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const anchor = await page.evaluate(() => {
        const points = window.__test_instruction_seam_geometry__!.screenTriangle;
        const rect = document.getElementById("canvas")!.getBoundingClientRect();
        return { x: (points[0][0] + points[1][0]) / 2 / window.devicePixelRatio + rect.left,
            y: (points[0][1] + points[1][1]) / 2 / window.devicePixelRatio + rect.top };
    });
    await page.mouse.move(anchor.x, anchor.y);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);
    const junction = await page.evaluate(() => {
        const points = window.__test_instruction_seam_geometry__!.screenTriangle;
        const x = (points[0][0] + points[1][0]) / 2;
        const y = (points[0][1] + points[1][1]) / 2;
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        if (x < 2 || x >= canvas.width || y < 0 || y >= canvas.height) throw new Error("junction is outside the chart viewport");
        return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(x) - 1, Math.round(y), 1, 1).data).slice(0, 3);
    });
    expect(junction).toEqual([214, 83, 163]);
});

test("the joined seam triangle keeps its cell proportions through zoom", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const shape = () => page.evaluate(() => {
        const points = window.__test_instruction_seam_geometry__!.screenTriangle;
        const matrix = window.__test_matrix__!;
        const cell = Math.hypot(matrix.a, matrix.b);
        const base = { x: (points[0][0] + points[1][0]) / 2, y: (points[0][1] + points[1][1]) / 2 };
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const colour = Array.from(canvas.getContext("2d")!.getImageData(Math.round(base.x), Math.round(base.y), 1, 1).data).slice(0, 3);
        return { depth: Math.hypot(points[2][0] - base.x, points[2][1] - base.y) / cell,
            base: Math.hypot(points[0][0] - points[1][0], points[0][1] - points[1][1]) / cell, colour };
    });
    const before = await shape();
    expect(before.depth).toBeCloseTo(0.32);
    expect(before.base).toBeCloseTo(0.44);
    expect(before.colour).toEqual([214, 83, 163]);
    const anchor = await page.evaluate(() => {
        const points = window.__test_instruction_seam_geometry__!.screenTriangle;
        const rect = document.getElementById("canvas")!.getBoundingClientRect();
        return { x: (points[0][0] + points[1][0]) / 2 / window.devicePixelRatio + rect.left,
            y: (points[0][1] + points[1][1]) / 2 / window.devicePixelRatio + rect.top };
    });
    await page.mouse.move(anchor.x, anchor.y);
    for (let i = 0; i < 5; i++) await page.mouse.wheel(0, -100);
    await page.waitForTimeout(100);
    const after = await shape();
    expect(after.depth).toBeCloseTo(before.depth);
    expect(after.base).toBeCloseTo(before.base);
    expect(after.colour).toEqual(before.colour);
});

test("a single-cell Quarter has only its beginning seam and an inward triangle", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Quarter", { exact: true }).click();
    await page.locator("#edit-inner-width").fill("0");
    await page.locator("#edit-inner-height").fill("0");
    await page.locator("#edit-rounds").fill("1");
    const endingPixel = () => page.evaluate(() => {
        const point = window.__test_matrix__!.transformPoint({ x: 1, y: 0.5 });
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.round(point.x), Math.round(point.y), 1, 1).data).slice(0, 3);
    });
    const plainEnd = await endingPixel();
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    expect(await endingPixel()).toEqual(plainEnd);
    const seam = await page.evaluate(() => window.__test_instruction_seam_geometry__);
    expect(seam!.edges).toEqual([[0, 0, 0, 1]]);
    expect(seam!.triangle[0][0]).toBe(0);
    expect(seam!.triangle[1][0]).toBe(0);
    expect(seam!.triangle[2][0]).toBeGreaterThan(0);
    expect(seam!.triangle[2][0]).toBeLessThan(1);
});

test("an adjacent first and last stitch share a seam only in a Full round", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("2");
    await page.locator("#edit-height").fill("2");
    await page.keyboard.press("Escape");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    expect((await page.evaluate(() => window.__test_instruction_seam_geometry__))!.edges)
        .toEqual([[0, 1, 0, 2]]);
    await page.getByRole("button", { name: "Back to Design" }).click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.locator("#edit-inner-width").fill("0");
    await page.locator("#edit-inner-height").fill("0");
    await page.locator("#edit-rounds").fill("1");
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const seam = await page.evaluate(() => window.__test_instruction_seam_geometry__);
    expect(seam!.edges).toEqual([[1, 1, 2, 1]]);
    expect(seam!.triangle[0][1]).toBe(1);
    expect(seam!.triangle[1][1]).toBe(1);
    expect(seam!.triangle[2][1]).toBeLessThan(1);
});

for (const extent of ["Full", "Half", "Quarter"]) {
    test(`${extent} round numbers keep their historical chart anchors and remain visible in Fit`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Pattern" }).click();
        await page.getByText("Centre-out", { exact: true }).click();
        await page.getByText(extent, { exact: true }).click();
        await page.locator("#edit-inner-width").fill("1");
        await page.locator("#edit-inner-height").fill("1");
        await page.locator("#edit-rounds").fill("3");
        await page.keyboard.press("Escape");
        for (const [width, height] of [[1280, 800], [360, 740], [852, 393]]) {
            await page.setViewportSize({ width, height });
            for (const crochet of [false, true]) {
                if (crochet) {
                    await page.locator("#btn-export").click();
                    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
                    const finalRound = page.locator('.instructions-unit[aria-label^="Round 3,"]');
                    if (await finalRound.getAttribute("aria-current") !== "step") await finalRound.click();
                }
                for (const rotated of [false, true]) {
                    if (rotated) {
                        await page.getByRole("button", { name: "Rotate view right" }).click();
                        await page.waitForTimeout(300);
                    }
                    await page.getByRole("button", { name: "Fit view" }).click();
                    const { labels, viewUnchanged } = await page.evaluate(() => {
                        const m = window.__test_matrix__!;
                        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
                        const geometry = (window as typeof window & { __test_instruction_label_geometry__?: Array<{
                            anchor: { x: number; y: number };
                            bounds: { left: number; top: number; right: number; bottom: number };
                        }> }).__test_instruction_label_geometry__!;
                        const ctx = canvas.getContext("2d")!;
                        const samples = geometry.map(({ anchor, bounds }) => {
                            const point = m.inverse().transformPoint(anchor);
                            const left = Math.max(0, Math.floor(bounds.left));
                            const top = Math.max(0, Math.floor(bounds.top));
                            const right = Math.min(canvas.width, Math.ceil(bounds.right));
                            const bottom = Math.min(canvas.height, Math.ceil(bounds.bottom));
                            const pixels = ctx.getImageData(left, top, right - left, bottom - top).data;
                            return { x: point.x, y: point.y, bounds, pixels, left, top, right, bottom };
                        });
                        const numbers = document.getElementById("labels-on") as HTMLInputElement;
                        const matrix = m.toFloat64Array();
                        // Compare the same view with numbers hidden; antialiasing depends on the system font.
                        numbers.click();
                        try {
                            const viewUnchanged = Array.from(window.__test_matrix__!.toFloat64Array())
                                .every((value, i) => value === matrix[i]);
                            const labels = samples.map(({ x, y, bounds, pixels, left, top, right, bottom }) => {
                                const hidden = ctx.getImageData(left, top, right - left, bottom - top).data;
                                let inkPixels = 0;
                                for (let i = 0; i < pixels.length; i += 4) {
                                    if (pixels[i] !== hidden[i] || pixels[i + 1] !== hidden[i + 1]
                                        || pixels[i + 2] !== hidden[i + 2]) inkPixels++;
                                }
                                return { x, y, bounds, inkPixels, width: canvas.width, height: canvas.height };
                            });
                            return { labels, viewUnchanged };
                        } finally {
                            numbers.click();
                        }
                    });
                    expect(viewUnchanged).toBe(true);
                    expect(labels).toHaveLength(3);
                    labels.forEach((label, i) => {
                        expect(label.x).toBeCloseTo(i + 0.5);
                        expect(label.y).toBeCloseTo(extent === "Full" ? i + 0.5 : -0.3);
                        expect(label.bounds.left).toBeGreaterThanOrEqual(0);
                        expect(label.bounds.top).toBeGreaterThanOrEqual(0);
                        expect(label.bounds.right).toBeLessThanOrEqual(label.width);
                        expect(label.bounds.bottom).toBeLessThanOrEqual(label.height);
                        expect(label.inkPixels, `${extent} label ${3 - i}, ${width}×${height}, crochet=${crochet}, rotated=${rotated}`)
                            .toBeGreaterThan(0);
                    });
                }
                await page.getByRole("button", { name: /Reset view orientation/ }).click();
                await page.waitForTimeout(300);
                if (crochet) await page.locator("#btn-export").click();
            }
        }
    });
}

test("partial-round beginning markers leave the historical number glyphs readable after rotation", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByText("Quarter", { exact: true }).click();
    await page.locator("#edit-rounds").fill("3");
    await page.keyboard.press("Escape");
    const labelInk = () => page.evaluate(() => {
        const geometry = (window as typeof window & { __test_instruction_label_geometry__?: Array<{
            bounds: { left: number; top: number; right: number; bottom: number };
        }> }).__test_instruction_label_geometry__!;
        const ctx = (document.getElementById("canvas") as HTMLCanvasElement).getContext("2d")!;
        return geometry.map(({ bounds }) => {
            const pixels = ctx.getImageData(Math.floor(bounds.left), Math.floor(bounds.top),
                Math.ceil(bounds.right) - Math.floor(bounds.left), Math.ceil(bounds.bottom) - Math.floor(bounds.top)).data;
            const ink: number[] = [];
            for (let i = 0; i < pixels.length; i += 4) {
                if (pixels[i] > 100 && pixels[i + 1] > 100 && pixels[i + 2] > 100
                    && Math.abs(pixels[i] - pixels[i + 1]) <= 2
                    && pixels[i + 2] - pixels[i] >= 3 && pixels[i + 2] - pixels[i] <= 15) ink.push(i);
            }
            return ink;
        });
    });
    for (const rotated of [false, true]) {
        if (rotated) {
            await page.getByRole("button", { name: "Rotate view right" }).click();
            await page.waitForTimeout(300);
            await page.getByRole("button", { name: "Rotate view right" }).click();
            await page.waitForTimeout(300);
        }
        await page.getByRole("button", { name: "Fit view" }).click();
        const plain = await labelInk();
        plain.forEach(ink => expect(ink.length).toBeGreaterThan(0));
        await page.locator("#btn-export").click();
        await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
        await page.locator('.instructions-unit[aria-label^="Round 2,"]').click();
        expect(await labelInk()).toEqual(plain);
        await page.getByText("Alternate direction", { exact: true }).click();
        expect(await labelInk()).toEqual(plain);
        await page.locator("#btn-export").click();
    }
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
    const rowCount = await page.locator('.instructions-unit[aria-label^="Row"]').count();
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

    await page.getByRole("button", { name: "Whole pattern", exact: true }).click();
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

test("Crochet wraps through Whole around a single Centre-out round", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.getByLabel("Rounds").fill("1");

    await page.locator("#btn-export").click();
    await expect(page.locator('.instructions-unit[aria-label="Round 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    const back = page.getByRole("button", { name: "Back one round" });
    await expect(back).toBeEnabled();
    await expect(page.locator("#instructions-live-progress")).toHaveText("1 / 1");
    const whole = page.getByRole("button", { name: "Whole pattern", exact: true });
    await back.click();
    await expect(whole).toHaveAttribute("aria-current", "step");
    await back.click();
    await expect(page.locator('.instructions-unit[aria-label="Round 1, Yarn A"]')).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Forward one round" }).click();
    await expect(whole).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Forward one round" }).click();
    await expect(page.locator("#instructions-live-progress")).toHaveText("1 / 1");
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
    expect(copied).toContain("sc × 9");
    expect(copied).not.toContain("\u00a0");
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
