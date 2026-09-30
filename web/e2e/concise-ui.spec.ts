import { test, expect } from "@playwright/test";
import { bootApp, cellCoord, clickCell } from "./_helpers";

test("About and the idle canvas omit redundant guidance and status", async ({ page }) => {
    await page.goto("/");
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);

    const about = page.getByRole("dialog", { name: "Mosaic Crochet Editor" });
    await expect(about).toBeVisible();
    await expect(page.getByText("Begin with a blank chart", { exact: false })).toHaveCount(0);

    await page.getByRole("button", { name: "New", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("status", { name: "Browser recovery" })).toBeHidden();
    await expect(page.getByLabel("Canvas context")).toBeHidden();

    const cell = await cellCoord(page, 1, 1);
    await page.mouse.move(cell.cx, cell.cy);
    await expect(page.getByLabel("Canvas context")).toBeVisible();
    await expect(page.locator("#status-coordinates")).toHaveText("1, 1");
    await expect(page.getByLabel("Canvas context")).not.toContainText("Pencil");
    await expect(page.getByLabel("Canvas context")).not.toContainText("Yarn A");
    await expect(page.getByLabel("Canvas context")).not.toContainText("overlays");
});

test("Pattern owns all colour editing while Settings keeps non-colour preferences", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();

    await expect(page.getByLabel("Yarn A colour")).toHaveValue("#000000");
    await expect(page.getByLabel("Yarn B colour")).toHaveValue("#ffffff");
    await expect(page.getByRole("button", { name: "Swap yarn colours" })).toBeVisible();
    for (const name of [
        "Reset Yarn A to default", "Reset Yarn B to default",
        "Reset danger colour", "Reset accent colour",
    ]) {
        const reset = page.getByRole("button", { name });
        await expect(reset).toBeVisible();
        await expect(reset).toHaveText("");
        await expect(reset).toBeDisabled();
    }
    await page.getByLabel("Yarn A colour").fill("#123456");
    await expect(page.getByRole("button", { name: "Reset Yarn A to default" })).toBeEnabled();
    await page.getByRole("button", { name: "Reset Yarn A to default" }).click();
    await expect(page.getByRole("button", { name: "Reset Yarn A to default" })).toBeDisabled();
    await expect(page.getByRole("button", { name: /new patterns/i })).toHaveCount(0);
    const preview = page.getByRole("img", { name: /Rows colour preview/ });
    await expect(preview).toBeVisible();
    await expect(page.getByText("× overlay stitch · ! invalid overlay placement")).toHaveCount(0);
    await expect(page.locator("#edit-yarn")).toHaveCount(0);
    const danger = page.getByLabel("Project danger colour");
    const accent = page.getByLabel("Project accent colour");
    for (const picker of [danger, accent]) {
        expect(await picker.evaluate(element => {
            const style = getComputedStyle(element);
            return style.opacity !== "0" && style.pointerEvents !== "none";
        })).toBe(true);
    }
    await danger.fill("#123456");
    await accent.fill("#abcdef");
    expect(await preview.evaluate(element => {
        const canvas = element.querySelector("canvas")!;
        const ctx = canvas.getContext("2d")!;
        const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
        let danger = false;
        let accent = false;
        let yarnA = false;
        let yarnB = false;
        for (let i = 0; i < pixels.length; i += 4) {
            if (pixels[i] === 18 && pixels[i + 1] === 52 && pixels[i + 2] === 86) danger = true;
            if (pixels[i] === 171 && pixels[i + 1] === 205 && pixels[i + 2] === 239) accent = true;
            if (pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0) yarnA = true;
            if (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255) yarnB = true;
        }
        return { yarnA, yarnB, accent, danger };
    })).toEqual({
        yarnA: true,
        yarnB: true,
        accent: true,
        danger: true,
    });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document))
        .toMatchObject({ dangerColorOverride: "#123456", accentColorOverride: "#abcdef" });

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Settings" }).click();
    const settings = page.locator("#hl-popover");

    await expect(page.locator("#show-guidance")).toHaveCount(0);
    await expect(page.getByRole("slider", { name: "Guidance opacity" })).toHaveAttribute("min", "0");
    await expect(settings.getByLabel("Project danger colour")).toHaveCount(0);
    await expect(settings.getByLabel("Project accent colour")).toHaveCount(0);
    await expect(page.locator("label:has(#lock-invalid)"))
        .toHaveAttribute("title", "Block new marks on cells that cannot host an overlay");
});

test("the pattern swatch uses the chart's row and concentric-round yarn geometry", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    const sample = async () => page.locator("#pattern-colour-preview canvas").evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d")!;
        const n = 7;
        const at = (x: number, y: number) => {
            const padding = 8 * window.devicePixelRatio;
            const p = ctx.getImageData(padding + (x + 0.25) * (canvas.width - 2 * padding) / n,
                padding + (y + 0.6) * (canvas.height - 2 * padding) / n, 1, 1).data;
            return Array.from(p).slice(0, 3);
        };
        return { rowTop: [at(0, 0), at(6, 0)], rowNext: [at(0, 1), at(6, 1)],
            outer: [at(0, 0), at(6, 0), at(0, 6), at(6, 6)],
            inner: [at(1, 2), at(5, 2), at(2, 1), at(2, 5)], center: at(3, 3) };
    });
    const rows = await sample();
    expect(rows.rowTop[0]).toEqual(rows.rowTop[1]);
    expect(rows.rowNext[0]).toEqual(rows.rowNext[1]);
    expect(rows.rowTop[0]).not.toEqual(rows.rowNext[0]);
    await page.getByText("Centre-out", { exact: true }).click();
    const rounds = await sample();
    expect(rounds.outer.every(color => JSON.stringify(color) === JSON.stringify(rounds.outer[0]))).toBe(true);
    expect(rounds.inner.every(color => JSON.stringify(color) === JSON.stringify(rounds.inner[0]))).toBe(true);
    expect(rounds.outer[0]).not.toEqual(rounds.inner[0]);
    expect(rounds.center).not.toEqual(rounds.outer[0]);
    expect(rounds.center).not.toEqual(rounds.inner[0]);
});

test.describe("responsive pattern swatch", () => {
    test.use({ deviceScaleFactor: 2 });

    test("fills the panel with padding and sizes its bitmap for the display", async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Pattern" }).click();
        const preview = page.locator("#pattern-preview-canvas");
        const measure = () => preview.evaluate((canvas: HTMLCanvasElement) => ({
            width: canvas.clientWidth,
            available: canvas.closest(".pattern-colours")!.clientWidth,
            bitmapWidth: canvas.width,
            bitmapHeight: canvas.height,
            expected: Math.round(canvas.clientWidth * window.devicePixelRatio),
        }));
        for (const viewport of [{ width: 1280, height: 900 }, { width: 800, height: 900 }]) {
            await page.setViewportSize(viewport);
            await expect.poll(async () => {
                const size = await measure();
                return size.bitmapWidth === size.expected && size.bitmapHeight === size.expected;
            }).toBe(true);
            const size = await measure();
            expect(size.available - size.width).toBeGreaterThan(0);
            expect(size.available - size.width).toBeLessThanOrEqual(24);
        }
    });
});

test("swatch shows its diagonal mirror in the project accent colour", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByLabel("Project accent colour").fill("#123456");
    expect(await page.locator("#pattern-preview-canvas").evaluate((canvas: HTMLCanvasElement) => {
        const ctx = canvas.getContext("2d")!;
        let accentPixels = 0;
        for (let x = canvas.width * 0.1; x < canvas.width * 0.4; x++) {
            const p = ctx.getImageData(x, x, 1, 1).data;
            if (p[0] === 18 && p[1] === 52 && p[2] === 86) accentPixels++;
        }
        return accentPixels;
    })).toBeGreaterThan(10);
});

test("swatch selection marches while visible and pauses for reduced motion and closed Pattern", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    const preview = page.locator("#pattern-preview-canvas");
    const bitmap = () => preview.evaluate((canvas: HTMLCanvasElement) => canvas.toDataURL());
    const initial = await bitmap();
    await expect.poll(bitmap).not.toBe(initial);
    await page.emulateMedia({ reducedMotion: "reduce" });
    await page.waitForTimeout(100);
    const still = await bitmap();
    await page.waitForTimeout(250);
    expect(await bitmap()).toBe(still);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await expect.poll(bitmap).not.toBe(still);
    await page.keyboard.press("Escape");
    await page.waitForTimeout(100);
    const hidden = await bitmap();
    await page.waitForTimeout(250);
    expect(await bitmap()).toBe(hidden);
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect.poll(bitmap).not.toBe(hidden);
});

test("Pattern colour resets use fixed app defaults and contrast suggestions stay outside undo", async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem("mosaic-preferences", JSON.stringify({
        version: 1,
        guidanceOpacity: 100,
        dangerColor: "#aa0000",
        accentColor: "#006699",
        labelsVisible: true,
        lockInvalid: true,
    })));
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();

    const danger = page.getByLabel("Project danger colour");
    const accent = page.getByLabel("Project accent colour");
    await expect(danger).toHaveValue("#ff0000");
    await expect(accent).toHaveValue("#d653a3");

    await danger.fill("#123456");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.dangerColorOverride,
    )).toBe("#123456");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-preferences")!).dangerColor))
        .toBe("#ff0000");

    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(danger).toHaveValue("#123456");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.dangerColorOverride,
    )).toBe("#123456");

    await page.getByRole("button", { name: "Reset danger colour" }).click();
    await expect(danger).toHaveValue("#ff0000");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.dangerColorOverride,
    )).toBeNull();

    const historyBefore = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    );
    await page.getByRole("button", { name: "Find contrasting colors" }).click();
    await expect(danger).toHaveValue("#d32f2f");
    await expect(accent).toHaveValue("#00838f");
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length,
    )).toBe(historyBefore);

    await page.getByRole("button", { name: "Reset accent colour" }).click();
    await expect(accent).toHaveValue("#d653a3");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.accentColorOverride,
    )).toBeNull();

    await page.getByLabel("Yarn A colour").fill("#112233");
    await page.getByLabel("Yarn B colour").fill("#445566");
    await page.getByRole("button", { name: "Reset Yarn A to default" }).click();
    await page.getByRole("button", { name: "Reset Yarn B to default" }).click();
    await expect(page.getByLabel("Yarn A colour")).toHaveValue("#000000");
    await expect(page.getByLabel("Yarn B colour")).toHaveValue("#ffffff");
});

test("opening project contrast overrides keeps app defaults and Crochet progress", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await page.locator("#btn-export").click();
    const project = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document);
    const defaults = await page.evaluate(() => localStorage.getItem("mosaic-preferences"));

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "contrast-overrides.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 3,
            ...project,
            axes: [],
            recipes: [],
            dangerColorOverride: "#123456",
            accentColorOverride: "#abcdef",
        })),
    });

    expect(await page.evaluate(() => localStorage.getItem("mosaic-preferences"))).toBe(defaults);
    await expect(page.locator("#btn-export")).toContainText("Continue Crocheting");
    await page.getByRole("button", { name: "Pattern" }).click();
    await expect(page.getByLabel("Project danger colour")).toHaveValue("#123456");
    await expect(page.getByLabel("Project accent colour")).toHaveValue("#abcdef");
});

test("app preferences survive reload and are not part of undo or recovery snapshots", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    const opacity = page.getByRole("slider", { name: "Guidance opacity" });
    await opacity.fill("37");
    await page.keyboard.press("Escape");

    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Undo" }).click();
    expect(await page.evaluate(() => {
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return { preferences: recovery.preferences, stored: localStorage.getItem("mosaic-preferences") };
    })).toEqual({
        preferences: undefined,
        stored: JSON.stringify({
            version: 1,
            guidanceOpacity: 37,
            dangerColor: "#ff0000",
            accentColor: "#d653a3",
            labelsVisible: true,
            lockInvalid: true,
        }),
    });

    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    await page.getByRole("button", { name: "Settings" }).click();
    await expect(page.getByRole("slider", { name: "Guidance opacity" })).toHaveValue("37");
});

test("status is passive and Select opens selection actions", async ({ page }) => {
    await bootApp(page);

    const emptySelection = page.getByRole("button", { name: "Select", exact: true });
    await expect(emptySelection).toBeEnabled();
    await emptySelection.click();
    await expect(page.getByRole("button", { name: "Selection 1 Empty" })).toBeVisible();
    await expect(page.getByRole("button", { name: "New selection" })).toBeVisible();
    await page.keyboard.press("Escape");

    await page.keyboard.press("Control+a");

    const status = page.getByLabel("Canvas context");
    await expect(status.getByRole("button")).toHaveCount(0);
    const selection = page.getByRole("button", { name: "Select", exact: true });
    await expect(page.locator("#status-selection")).toContainText("81");
    await selection.click();
    await expect(page.getByRole("button", { name: "Copy" })).toBeVisible();
});

test("contextual inspectors rely on controls and hover text", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+a");
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await expect(page.getByText("Deselect places", { exact: false })).toHaveCount(0);
    await expect(page.getByText("Nothing copied yet", { exact: false })).toHaveCount(0);

    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await expect(page.getByText("Select cells and configure", { exact: false })).toHaveCount(0);
    await expect(page.getByText("No axes yet", { exact: false })).toHaveCount(0);
});

test("Crochet omits redundant panel and list headings", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();

    await expect(page.getByRole("group", { name: "Crochet options" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Crochet" })).toHaveCount(0);
    await expect(page.getByRole("heading", { name: "Instructions" })).toHaveCount(0);
    await expect(page.getByText("Chart-derived work in crochet order.", { exact: false })).toHaveCount(0);
});

test("Crochet summarizes errors without prose or navigation", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 0);
    await clickCell(page, 1, 0);

    await page.locator("#btn-export").click();
    await expect(page.getByRole("status", { name: "Crochet errors" })).toHaveText("2 errors");
    await expect(page.getByLabel("Instruction blockers")).toHaveCount(0);
    await expect(page.getByText(/unresolved|draft|resolve chart/i)).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Forward one row" })).toBeEnabled();
});
