import { expect, test } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB } from "./_helpers";

for (const extent of ["Rows", "Full", "Half", "Quarter"] as const) {
    test(`${extent} Whole reveals warnings outside generated work using project Danger`, async ({ page }) => {
        await bootApp(page);
        const rows = extent === "Rows";
        const width = extent === "Quarter" ? 4 : 7;
        const height = extent === "Half" || extent === "Quarter" ? 4 : 7;
        const offsetY = height === 4 ? 3 : 0;
        const pixels = Array.from({ length: width * height }, (_, index) => {
            const x = index % width, y = Math.floor(index / width) + offsetY;
            const distance = rows ? 6 - y : Math.min(x, y, 6 - x, 6 - y);
            return distance > 2 && !rows ? 0 : distance % 2 === 0 ? 1 : 2;
        });
        const warning = rows ? { x: 2, y: -1 } : { x: -1, y: 2 };
        pixels[rows ? 2 : 2 * width] = 2;
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Open", exact: true }).click();
        await (await chooser).setFiles({ name: "outward.mcw", mimeType: "application/json",
            buffer: Buffer.from(JSON.stringify({ version: 1, state: rows
                ? { mode: "row", canvasWidth: width, canvasHeight: height }
                : { mode: "round", canvasWidth: width, canvasHeight: height,
                    virtualWidth: 7, virtualHeight: 7, offsetX: 0, offsetY, rounds: 3 },
            pixels, colorA: "#000000", colorB: "#ffffff" })) });
        await page.locator("#btn-export").click();
        const whole = page.getByRole("button", { name: "Whole pattern, contains invalid placements", exact: true });
        await expect(whole).toBeVisible();
        await expect(page.locator('.instructions-unit[aria-label^="Row"], .instructions-unit[aria-label^="Round"]'))
            .toHaveCount(rows ? height : 3);
        await whole.click();
        expect(await page.evaluate(() => (window as typeof window & {
            __test_instruction_guidance__?: { invalidGlyphCoords: { x: number; y: number }[] };
        }).__test_instruction_guidance__!.invalidGlyphCoords)).toContainEqual(warning);
        const point = await cellCoord(page, warning.x, warning.y);
        expect(await pixelRGB(page, point.cx, point.cy)).toEqual([255, 0, 0]);
        await page.getByRole("button", { name: "Pattern", exact: true }).click();
        await page.locator("#danger-color").evaluate((input: HTMLInputElement) => {
            input.value = "#ff00ff"; input.dispatchEvent(new Event("input", { bubbles: true }));
        });
        expect(await pixelRGB(page, point.cx, point.cy)).toEqual([255, 0, 255]);
        await expect(whole).toHaveAttribute("aria-current", "step");
        await page.keyboard.press("Escape");
        const last = page.locator('.instructions-unit[aria-label^="Row"], .instructions-unit[aria-label^="Round"]').last();
        await last.click();
        expect(await page.evaluate(() => (window as typeof window & {
            __test_instruction_guidance__?: { filtered: boolean; invalidGlyphCoords: { x: number; y: number }[] };
        }).__test_instruction_guidance__!)).toMatchObject({ filtered: true, invalidGlyphCoords: [] });
        expect(await page.evaluate(() => window.__test_instruction_seam_geometry__)).not.toBeNull();
        const kind = rows ? "row" : "round";
        await page.getByRole("button", { name: `Forward one ${kind}` }).click();
        await expect(whole).toHaveAttribute("aria-current", "step");
        await page.getByRole("button", { name: `Forward one ${kind}` }).click();
        await expect(page.getByRole("button", { name: `${rows ? "Row" : "Round"} 1, Yarn A`, exact: true }))
            .toHaveAttribute("aria-current", "step");
        await page.getByRole("button", { name: `Back one ${kind}` }).click();
        await expect(whole).toHaveAttribute("aria-current", "step");
        await page.getByRole("button", { name: `Back one ${kind}` }).click();
        await expect(last).toHaveAttribute("aria-current", "step");
    });
}

test("interior corner warnings remain owned by their generated round", async ({ page }) => {
    await bootApp(page);
    const pixels = Array.from({ length: 49 }, (_, index) => {
        const x = index % 7, y = Math.floor(index / 7);
        const distance = Math.min(x, y, 6 - x, 6 - y);
        return distance > 2 ? 0 : distance % 2 === 0 ? 1 : 2;
    });
    pixels[8] = 1;
    pixels[1] = 0;
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "hole-corner.mcw", mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ version: 1,
            state: { mode: "round", canvasWidth: 7, canvasHeight: 7, virtualWidth: 7, virtualHeight: 7,
                offsetX: 0, offsetY: 0, rounds: 3 }, pixels, colorA: "#000000", colorB: "#ffffff" })) });
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Whole pattern", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Round 3, Yarn A, contains invalid placements", exact: true })).toBeVisible();
});

test("warnings owned by a generated row stay on that row", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 0, 2);
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 0, 1);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Row 9, Yarn A, contains invalid placements", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Whole pattern", exact: true })).toBeVisible();
});

test("Whole pattern is transient progress and wraps around real rows", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    const row = page.getByRole("button", { name: "Row 3, Yarn A", exact: true });
    await row.click();
    const saved = await page.evaluate(() => localStorage.getItem("mosaic-live-progress"));
    const whole = page.getByRole("button", { name: "Whole pattern", exact: true });
    await expect(whole).toBeVisible();
    await whole.click();
    await expect(whole).toHaveAttribute("aria-current", "step");
    await expect(page.locator("#instructions-live-progress")).toHaveText("Whole pattern");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-live-progress"))).toBe(saved);
    expect(await page.evaluate(() => window.__test_instruction_seam_geometry__)).toBeNull();
    await page.locator("#btn-export").click();
    await page.locator("#btn-export").click();
    await expect(row).toHaveAttribute("aria-current", "step");
    await whole.click();
    await page.reload();
    await page.locator("#btn-export").click();
    await expect(row).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Row 9, Yarn A", exact: true }).click();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await expect(whole).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Forward one row" }).click();
    await expect(page.getByRole("button", { name: "Row 1, Yarn A", exact: true })).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Back one row" }).click();
    await expect(whole).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Back one row" }).click();
    await expect(page.getByRole("button", { name: "Row 9, Yarn A", exact: true })).toHaveAttribute("aria-current", "step");
});

test("the final real row keeps focused guidance and descriptive hover text", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 4, 8);
    await page.locator("#btn-export").click();
    const last = page.getByRole("button", { name: "Row 9, Yarn A", exact: true });
    await last.click();
    const guidance = await page.evaluate(() => (window as typeof window & {
        __test_instruction_guidance__?: { filtered: boolean; validGlyphCoords: { x: number; y: number }[] };
    }).__test_instruction_guidance__!);
    expect(guidance.filtered).toBe(true);
    expect(guidance.validGlyphCoords.every(({ y }) => y === 0)).toBe(true);
    expect(await page.evaluate(() => window.__test_instruction_seam_geometry__)).not.toBeNull();
    await expect(last).toHaveAttribute("title", "Row 9, Yarn A");
    const whole = page.getByRole("button", { name: "Whole pattern", exact: true });
    await whole.click();
    const complete = await page.evaluate(() => (window as typeof window & {
        __test_instruction_guidance__?: { filtered: boolean; validGlyphCoords: { x: number; y: number }[] };
    }).__test_instruction_guidance__!);
    expect(complete.filtered).toBe(false);
    expect(complete.validGlyphCoords).toContainEqual({ x: 4, y: 7 });
    const authored = await cellCoord(page, 4, 8);
    expect(await pixelRGB(page, authored.cx, authored.cy)).not.toEqual([22, 22, 24]);
});

test("Whole stays selected through direction and colour changes and is absent from copied instructions", async ({ page }) => {
    await page.addInitScript(() => Object.defineProperty(navigator, "clipboard", { configurable: true,
        value: { writeText: async (text: string) => { (window as typeof window & { copied: string }).copied = text; } } }));
    await bootApp(page);
    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Row 2, Yarn B", exact: true }).click();
    const saved = await page.evaluate(() => localStorage.getItem("mosaic-live-progress"));
    const whole = page.getByRole("button", { name: "Whole pattern", exact: true });
    await expect(whole).toBeVisible();
    await whole.click();
    await whole.focus();
    await page.locator("#alternate").evaluate((input: HTMLInputElement) => {
        input.checked = true; input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(whole).toBeFocused();
    await expect(whole).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#color-a").evaluate((input: HTMLInputElement) => {
        input.value = "#123456"; input.dispatchEvent(new Event("input", { bubbles: true }));
    });
    await expect(whole).toHaveAttribute("aria-current", "step");
    await expect(page.locator('.instructions-unit-number[data-yarn="A"]').first()).toHaveCSS("background-color", "rgb(18, 52, 86)");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-live-progress"))).toBe(saved);
    await page.getByRole("button", { name: "Copy instructions" }).click();
    const text = await page.evaluate(() => (window as typeof window & { copied: string }).copied);
    expect(text.split("\n")).toHaveLength(9);
    expect(text).not.toContain("Whole pattern");
    expect(text.split("\n").map(line => line.match(/^Row \d+ · Yarn ([AB]):/)![1])).toEqual(["A", "B", "A", "B", "A", "B", "A", "B", "A"]);
});

test("Whole does not enter files or authored history, identical Open retains it, and stitch edits resume the real instruction", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => {
        const target = window as unknown as { savedMcw?: string; showSaveFilePicker?: () => Promise<unknown> };
        target.showSaveFilePicker = async () => ({ createWritable: async () => ({
            write: async (source: string) => { target.savedMcw = source; }, close: async () => {},
        }) });
    });
    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Row 4, Yarn B", exact: true }).click();
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const before = await page.evaluate(() => ({
        file: (window as unknown as { savedMcw: string }).savedMcw,
        history: localStorage.getItem("mosaic-history"), recovery: localStorage.getItem("mosaic-recovery"),
        progress: localStorage.getItem("mosaic-live-progress"),
    }));
    const whole = page.getByRole("button", { name: "Whole pattern", exact: true });
    await expect(whole).toBeVisible();
    await whole.focus();
    await page.keyboard.press("Enter");
    await expect(whole).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect(await page.evaluate(() => ({
        file: (window as unknown as { savedMcw: string }).savedMcw,
        history: localStorage.getItem("mosaic-history"), recovery: localStorage.getItem("mosaic-recovery"),
        progress: localStorage.getItem("mosaic-live-progress"),
    }))).toEqual(before);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "same.mcw", mimeType: "application/json", buffer: Buffer.from(before.file) });
    await expect(whole).toHaveAttribute("aria-current", "step");
    await page.locator("#btn-export").click();
    await clickCell(page, 3, 1);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Row 4, Yarn B", exact: true })).toHaveAttribute("aria-current", "step");
    await page.getByRole("button", { name: "Row 4, Yarn B", exact: true }).focus();
    await page.locator("#alternate").evaluate((input: HTMLInputElement) => {
        input.checked = !input.checked; input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(page.getByRole("button", { name: "Row 4, Yarn B", exact: true })).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-live-progress"))).toBe(before.progress);
});
