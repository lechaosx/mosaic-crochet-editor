import { expect, test } from "@playwright/test";
import { bootApp, clickCell, cellCoord } from "./_helpers";
import { contrastingProjectColors } from "../src/contrast-colors";

for (const width of [1440, 390]) {
    test(`Crochet mode button shares ordinary document button states at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 900 });
        await bootApp(page);
        const mode = page.locator("#btn-export");
        const ordinary = page.getByRole("button", { name: width === 1440 ? "Pattern" : "Menu", exact: true });
        const appearance = async (button: typeof mode) => button.evaluate(element => {
            const style = getComputedStyle(element);
            return { background: style.backgroundColor, border: style.borderColor, color: style.color };
        });
        for (const label of ["Begin Crocheting", "Back to Design"]) {
            await expect(mode).toHaveAccessibleName(label);
            await page.mouse.move(width - 1, 899);
            await expect.poll(async () => appearance(mode)).toEqual(await appearance(ordinary));
            await ordinary.hover();
            await page.waitForTimeout(200);
            const hovered = await appearance(ordinary);
            await page.mouse.down();
            await page.waitForTimeout(200);
            const pressed = await appearance(ordinary);
            await page.mouse.move(width - 1, 899);
            await page.mouse.up();
            await mode.hover();
            await expect.poll(async () => appearance(mode)).toEqual(hovered);
            await page.mouse.down();
            await expect.poll(async () => appearance(mode)).toEqual(pressed);
            await page.mouse.move(width - 1, 899);
            await page.mouse.up();
            if (label === "Begin Crocheting") await mode.click();
        }
    });
}

for (const commit of [false, true]) {
    test(`returning Pattern dimensions to their starting values preserves history and Crochet progress (${commit ? "Enter" : "preview"})`, async ({ page }) => {
        await bootApp(page);
        await page.locator("#btn-export").click();
        await page.getByRole("button", { name: "Forward one row" }).click();
        await page.locator("#btn-export").click();
        const progress = await page.evaluate(() => localStorage.getItem("mosaic-live-progress"));
        const history = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!));
        await page.getByRole("button", { name: "Pattern", exact: true }).click();
        const width = page.locator("#edit-width"), height = page.locator("#edit-height");
        const originalWidth = await width.inputValue(), originalHeight = await height.inputValue();
        await height.fill("2");
        if (commit) await height.press("Enter");
        await expect(page.locator("#crochet-mode-label")).toHaveText("Begin Crocheting");
        expect(await page.evaluate(() => localStorage.getItem("mosaic-live-progress"))).toBe(progress);
        await height.fill(originalHeight);
        if (commit) await height.press("Enter");
        await width.fill(String(Number(originalWidth) + 2));
        if (commit) await width.press("Enter");
        await width.fill(originalWidth);
        if (commit) await width.press("Enter");
        await page.keyboard.press("Escape");
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!))).toEqual(history);
        await expect(page.locator("#crochet-mode-label")).toHaveText("Continue Crocheting");
        await page.locator("#btn-export").click();
        await expect(page.locator(".instructions-unit[aria-current='step']")).toHaveAccessibleName("Row 2, Yarn B");
    });
}

test("Clear design availability follows composed drawing content and Undo", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await expect(page.locator("#edit-reset")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await expect(page.locator("#edit-reset")).toBeDisabled();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Pencil", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await expect(page.locator("#edit-reset")).toBeEnabled();
    await page.locator("#edit-reset").click();
    await expect(page.locator("#edit-reset")).toBeDisabled();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("#edit-reset")).toBeEnabled();
    await page.getByRole("button", { name: "Redo", exact: true }).click();
    await expect(page.locator("#edit-reset")).toBeDisabled();
    await page.getByText("Centre-out", { exact: true }).click();
    for (const extent of ["Full", "Half", "Quarter"]) {
        await page.getByText(extent, { exact: true }).click();
        await expect(page.locator("#edit-reset")).toBeDisabled();
    }
});

for (const kind of ["danger", "accent"] as const) {
    test(`automatic guidance colours follow yarns while matching ${kind} stays custom`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Pattern", exact: true }).click();
        const initial = contrastingProjectColors("#000000", "#ffffff");
        const danger = page.locator("#danger-color"), accent = page.locator("#accent-color");
        const resetDanger = page.getByRole("button", { name: "Use automatic Danger colour", exact: true });
        const resetAccent = page.getByRole("button", { name: "Use automatic Accent colour", exact: true });
        await expect(danger).toHaveValue(initial.danger);
        await expect(accent).toHaveValue(initial.accent);
        await expect(resetDanger).toBeDisabled();
        await expect(resetAccent).toBeDisabled();
        await expect(danger).toHaveAccessibleDescription("Automatic");
        await expect(accent).toHaveAccessibleDescription("Automatic");
        await expect(page.getByRole("button", { name: "Find contrast" })).toHaveCount(0);
        const custom = kind === "danger" ? danger : accent;
        const other = kind === "danger" ? accent : danger;
        const reset = kind === "danger" ? resetDanger : resetAccent;
        const otherKind = kind === "danger" ? "accent" : "danger";
        await custom.fill(initial[kind]);
        await custom.dispatchEvent("input");
        await custom.dispatchEvent("change");
        await expect(reset).toBeEnabled();
        await expect(page.locator(`#${kind}-color-mode`)).toHaveText("Custom");
        await expect(custom).toHaveAccessibleDescription("Custom");
        await page.locator("#color-a").fill("#777777");
        await page.locator("#color-b").fill("#777777");
        const next = contrastingProjectColors("#777777", "#777777");
        await expect(custom).toHaveValue(initial[kind]);
        await expect(other).toHaveValue(next[otherKind]);
        await reset.click();
        await expect(custom).toHaveValue(next[kind]);
        await expect(custom).toHaveAccessibleDescription("Automatic");
        await expect(reset).toBeDisabled();
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        await expect(custom).toHaveValue(initial[kind]);
        await expect(reset).toBeEnabled();
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        await expect(reset).toBeDisabled();
        await page.reload();
        await page.waitForFunction(() => !!window.__test_matrix__);
        await page.getByRole("button", { name: "Pattern", exact: true }).click();
        await expect(danger).toHaveValue(next.danger);
        await expect(accent).toHaveValue(next.accent);
        await expect(reset).toBeDisabled();
    });
}

test("Crochet copy stays beside Alternate direction and overview warns by colour alone", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);
    await page.setViewportSize({ width: 360, height: 740 });
    await page.locator("#btn-export").click();
    const copy = page.locator("#export-copy"), toggle = page.locator("label:has(#alternate)");
    const boxes = await Promise.all([copy.boundingBox(), toggle.boundingBox()]);
    expect(Math.abs(boxes[0]!.y + boxes[0]!.height / 2 - boxes[1]!.y - boxes[1]!.height / 2)).toBeLessThan(1);
    const whole = page.getByRole("button", { name: /^Pattern overview/ });
    await whole.click();
    await expect(whole).toHaveClass(/instructions-unit--invalid/);
    expect(await whole.evaluate(el => getComputedStyle(el, "::before").content)).not.toContain("!");
    await expect(whole).toHaveText("Pattern overview");
    await page.locator("#btn-export").click();
    await expect(page.locator("#btn-export")).toHaveClass(/btn--danger/);
    await expect(page.locator("#crochet-mode-label")).toHaveText("Begin Crocheting");
});

for (const [width, textSize, round] of [[360, "100%", false], [320, "200%", false], [320, "200%", true], [700, "200%", true]] as const) {
    test(`Crochet ${round ? "round" : "row"} options and navigation remain reachable at ${width}px and ${textSize} text`, async ({ page }) => {
        await page.setViewportSize({ width, height: 740 });
        await bootApp(page);
        if (round) {
            const menu = page.getByRole("button", { name: "Menu", exact: true });
            if (await menu.isVisible()) {
                await menu.click();
                await page.getByRole("menuitem", { name: "Pattern", exact: true }).click();
            } else await page.getByRole("button", { name: "Pattern", exact: true }).click();
            await page.getByText("Centre-out", { exact: true }).click();
            await page.keyboard.press("Escape");
        }
        await page.evaluate(size => { document.documentElement.style.fontSize = size; }, textSize);
        await cellCoord(page, 0, 0);
        const matrix = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
        await page.locator("#btn-export").click();
        await expect(page.locator("#export-copy")).toBeEnabled();
        expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(matrix);
        const workspace = await page.locator("#instructions-workspace").boundingBox();
        const forward = await page.locator("#instructions-live-forward").boundingBox();
        expect(forward!.y + forward!.height).toBeLessThanOrEqual(workspace!.y + workspace!.height);
        const copy = await page.locator("#export-copy").boundingBox();
        const toggle = await page.locator("label:has(#alternate)").boundingBox();
        expect(Math.abs(copy!.y + copy!.height / 2 - toggle!.y - toggle!.height / 2)).toBeLessThan(1);
        if (round) {
            await page.locator(".instructions-unit:not(.instructions-unit--whole)").last().click();
            const current = page.locator("#instructions-current");
            await current.hover({ timeout: 3000 });
            const scrollPosition = () => current.evaluate(element =>
                element.scrollTop + element.closest(".instructions-body")!.scrollTop);
            const beforeScroll = await scrollPosition();
            await page.mouse.wheel(0, -200);
            await expect.poll(scrollPosition).not.toBe(beforeScroll);
            await page.locator(".instructions-unit").first().click();
        }
        await page.locator("label:has(#alternate)").click();
        await expect(page.locator("#alternate")).toBeChecked();
        await page.locator("#export-copy").click();
        await expect(page.locator("#export-action-status")).toHaveText(/Copied|Copy failed/);
        await page.getByRole("button", { name: `Forward one ${round ? "round" : "row"}`, exact: true }).click();
        await expect(page.locator("#instructions-live-progress")).toHaveText(round ? "2 / 5" : "2 / 9");
        await page.getByRole("button", { name: `Back one ${round ? "round" : "row"}`, exact: true }).click();
        await expect(page.locator("#instructions-live-progress")).toHaveText(round ? "1 / 5" : "1 / 9");
    });
}

for (const [width, height, textSize] of [[568, 320, "100%"], [760, 360, "100%"], [568, 320, "200%"], [760, 360, "200%"], [900, 500, "200%"]] as const) {
    test(`short landscape Crochet keeps chart space and visible navigation at ${width}px and ${textSize}`, async ({ page }) => {
        await page.setViewportSize({ width, height });
        await bootApp(page);
        await page.evaluate(size => { document.documentElement.style.fontSize = size; }, textSize);
        await cellCoord(page, 0, 0);
        const matrix = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
        await page.locator("#btn-export").click();
        await expect(page.locator("#export-copy")).toBeEnabled();
        const panel = await page.locator("#instructions-workspace").boundingBox();
        const canvas = await page.locator("#canvas").boundingBox();
        expect(panel!.x + panel!.width).toBeLessThan(canvas!.x + canvas!.width);
        const chartPoint = { x: (panel!.x + panel!.width + canvas!.x + canvas!.width) / 2,
            y: canvas!.y + canvas!.height * 0.6 };
        expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.id, chartPoint)).toBe("canvas");
        expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(matrix);
        const forward = await page.locator("#instructions-live-forward").boundingBox();
        expect(forward!.y + forward!.height).toBeLessThanOrEqual(height);
        const centre = { x: forward!.x + forward!.width / 2, y: forward!.y + forward!.height / 2 };
        expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest("button")?.id, centre))
            .toBe("instructions-live-forward");
        await page.mouse.click(centre.x, centre.y);
        await expect(page.locator("#instructions-live-progress")).toHaveText("2 / 9");
        await page.getByRole("button", { name: "Fit view", exact: true }).click();
        const chart = await page.evaluate(() => {
            const m = window.__test_matrix__!, rect = document.getElementById("canvas")!.getBoundingClientRect();
            const first = m.transformPoint({ x: 0, y: 0 }), last = m.transformPoint({ x: 9, y: 9 });
            return { left: first.x / devicePixelRatio + rect.left, right: last.x / devicePixelRatio + rect.left,
                top: first.y / devicePixelRatio + rect.top, bottom: last.y / devicePixelRatio + rect.top };
        });
        expect(chart.left).toBeGreaterThanOrEqual(panel!.x + panel!.width);
        expect(chart.right).toBeLessThanOrEqual(canvas!.x + canvas!.width);
        expect(chart.top).toBeGreaterThanOrEqual(canvas!.y);
        expect(chart.bottom).toBeLessThanOrEqual(canvas!.y + canvas!.height);
        expect(chart.right - chart.left).toBeGreaterThan(9);
    });
}

test("focused canvas controls retain focus and camera state when the Crochet layout changes", async ({ page }) => {
    await page.setViewportSize({ width: 568, height: 320 });
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.locator("#export-copy")).toBeEnabled();
    const fit = page.getByRole("button", { name: "Fit view", exact: true });
    await fit.focus();
    const camera = () => page.evaluate(() => {
        const m = window.__test_matrix__!, canvas = document.getElementById("canvas") as HTMLCanvasElement;
        return [m.a, m.b, m.c, m.d, m.e - canvas.width / 2, m.f - canvas.height / 2];
    });
    const before = await camera();
    const order = await page.locator(".canvas-controls button").evaluateAll(buttons => buttons.map(button => button.id));
    for (const size of [{ width: 760, height: 760 }, { width: 568, height: 320 }]) {
        await page.setViewportSize(size);
        await cellCoord(page, 0, 0);
        await expect(fit).toBeFocused();
        (await camera()).forEach((value, index) => expect(value).toBeCloseTo(before[index], 4));
        expect(await page.locator(".canvas-controls button").evaluateAll(buttons => buttons.map(button => button.id))).toEqual(order);
    }
});

test("enlarged desktop round instructions leave navigation unobstructed", async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 740 });
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.getByText("Centre-out", { exact: true }).click();
    await page.keyboard.press("Escape");
    await page.evaluate(() => { document.documentElement.style.fontSize = "200%"; });
    await cellCoord(page, 0, 0);
    const before = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
    await page.locator("#btn-export").click();
    await expect(page.locator("#export-copy")).toBeEnabled();
    expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(before);
    const forward = await page.locator("#instructions-live-forward").boundingBox();
    const centre = { x: forward!.x + forward!.width / 2, y: forward!.y + forward!.height / 2 };
    expect(await page.evaluate(point => document.elementFromPoint(point.x, point.y)?.closest("button")?.id, centre))
        .toBe("instructions-live-forward");
    await page.mouse.click(centre.x, centre.y);
    await expect(page.locator("#instructions-live-progress")).toHaveText("2 / 5");
});
