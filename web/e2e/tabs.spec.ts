// Open patterns as tabs: each keeps its own project, undo history, view and
// mode, while tools are shared.
import { test, expect, type Page } from "@playwright/test";
import { activeProjectId, bootApp, cellCoord, chartPixels, clickCell, deleteStoredRecovery, pixelRGB, storedLiveProgress, storedProjectIds,
         storedRecovery } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

const motif = JSON.stringify({
    version: 1, state: { mode: "row", canvasWidth: 9, canvasHeight: 9 },
    pixels: Array.from({ length: 81 }, (_, i) => Math.floor(i / 9) % 2 === 0 ? 1 : 2),
    colorA: "#123456", colorB: "#ffffff",
});

function tabs(page: Page) {
    return page.getByRole("tablist", { name: "Open patterns" }).getByRole("tab");
}

function tab(page: Page, name: string) {
    return page.getByRole("tab", { name: new RegExp(`^${name}\\b`) });
}

function emptyWorkspace(page: Page) {
    return page.getByRole("region", { name: "Start a pattern" });
}

async function newTab(page: Page) {
    await page.getByRole("button", { name: "New tab" }).click();
    await page.keyboard.press("Escape");
}

async function openExample(page: Page) {
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("#settings-about").click();
    await page.locator("#about-example").click();
}

async function openMotif(page: Page) {
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "motif.mcw", mimeType: "application/json", buffer: Buffer.from(motif) });
    await expect(tabs(page).last()).toHaveAttribute("aria-selected", "true");
}

async function cellRGB(page: Page, x: number, y: number) {
    const { cx, cy } = await cellCoord(page, x, y);
    return pixelRGB(page, cx, cy);
}

async function camera(page: Page) {
    return page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
}

test("New, Example and Open each open a clean tab, and opening a file again opens another", async ({ page }) => {
    await bootApp(page);
    await expect(tabs(page)).toHaveCount(1);
    await newTab(page);
    await openExample(page);
    await openMotif(page);
    await openMotif(page);

    await expect(tabs(page)).toHaveText(["Untitled 1", "Untitled 2", "Example", "motif.mcw", "motif.mcw"]);
    await expect(page.getByRole("tab", { name: /unsaved/ })).toHaveCount(0);
    await expect(tabs(page).last()).toHaveAttribute("aria-selected", "true");
    expect(await cellRGB(page, 0, 0)).toEqual([18, 52, 86]);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("each tab keeps its own document, selection, view, mode and progress, while tools are shared", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await clickCell(page, 2, 2);
    const selection = (await storedRecovery(page)).workspace.float;
    expect(selection).not.toBeNull();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const zoomed = await camera(page);
    await page.locator("#view-crochet").click();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await expect(page.locator("#instructions-live-progress")).toHaveText("2 / 9");

    await newTab(page);
    await expect(page.locator("#view-crochet")).toHaveAttribute("aria-selected", "false");
    await expect(page.locator("#view-crochet")).toHaveAttribute("title", "Start crochet instructions");
    expect(await camera(page)).not.toEqual(zoomed);
    expect(await cellRGB(page, 0, 1)).toEqual(B);
    expect((await storedRecovery(page)).workspace.float).toBeNull();
    await page.keyboard.press("m");

    await tab(page, "Untitled 1").click();
    await expect(page.locator("#view-crochet")).toHaveAttribute("aria-selected", "true");
    await expect(page.locator("#instructions-live-progress")).toHaveText("2 / 9");
    expect(await camera(page)).toEqual(zoomed);
    await page.locator("#view-design").click();
    expect(await cellRGB(page, 0, 1)).toEqual(A);
    expect((await storedRecovery(page)).workspace.float).toEqual(selection);
    await expect(page.locator("#tool-move")).toHaveAttribute("aria-pressed", "true");
});

test("switching tabs clears the previous tab's document messages", async ({ page }) => {
    await bootApp(page);
    await newTab(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "broken.mcw", mimeType: "application/json", buffer: Buffer.from("invalid") });
    await expect(page.locator("#document-error")).toBeVisible();
    await tab(page, "Untitled 1").click();
    await expect(page.locator("#document-error")).toBeHidden();
});

test("Save names the tab after the saved file and suggests the tab's title", async ({ page }) => {
    await bootApp(page);
    await page.evaluate(() => Object.assign(window, {
        showSaveFilePicker: async (options: { suggestedName: string }) => {
            (window as unknown as { suggested: string }).suggested = options.suggestedName;
            return { name: "scarf.mcw", createWritable: async () => ({ write: async () => {}, close: async () => {} }) };
        },
    }));
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect(tabs(page)).toHaveText(["scarf.mcw"]);
    expect(await page.evaluate(() => (window as unknown as { suggested: string }).suggested)).toBe("Untitled 1.mcw");

    await openMotif(page);
    await page.evaluate(() => { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    expect((await downloading).suggestedFilename()).toBe("motif.mcw");
    await expect(tabs(page)).toHaveText(["scarf.mcw", "motif.mcw"]);
});

test("each tab undoes only its own edits", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await newTab(page);
    await clickCell(page, 1, 1);

    await tab(page, "Untitled 1").click();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await cellRGB(page, 0, 1)).toEqual(B);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();

    await tab(page, "Untitled 2").click();
    expect(await cellRGB(page, 1, 1)).toEqual(A);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
});

// The cells showing ✕ and ! on the chart.
async function glyphs(page: Page) {
    return page.evaluate(() => {
        const guidance = (window as typeof window & { __test_instruction_guidance__?: {
            validGlyphCoords: { x: number; y: number }[]; invalidGlyphCoords: { x: number; y: number }[];
        } }).__test_instruction_guidance__!;
        return { cross: guidance.validGlyphCoords, warning: guidance.invalidGlyphCoords };
    });
}

test("each tab shows only its own ✕ and ! across switches and edits", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 2, 1);
    await expect.poll(async () => (await glyphs(page)).cross.length).toBeGreaterThan(0);
    const first = await glyphs(page);
    await newTab(page);
    await clickCell(page, 4, 3);
    await expect.poll(() => glyphs(page)).not.toEqual(first);
    const second = await glyphs(page);

    await tab(page, "Untitled 1").click();
    await expect.poll(() => glyphs(page)).toEqual(first);
    await clickCell(page, 6, 5);
    await expect.poll(() => glyphs(page)).not.toEqual(first);
    const edited = await glyphs(page);
    await tab(page, "Untitled 2").click();
    await expect.poll(() => glyphs(page)).toEqual(second);
    await tab(page, "Untitled 1").click();
    await expect.poll(() => glyphs(page)).toEqual(edited);
});

async function chartShows(page: Page, hex: string) {
    const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16));
    const { data } = await chartPixels(page);
    for (let i = 0; i < data.length; i += 4) if (data[i] === r && data[i + 1] === g && data[i + 2] === b) return true;
    return false;
}

async function controlAccents(page: Page) {
    await page.getByRole("button", { name: "Settings" }).click();
    const colours = {
        slider: await page.getByRole("slider", { name: "Guidance opacity" }).evaluate(el => getComputedStyle(el).accentColor),
        toggle: await page.getByLabel("Show numbers").evaluate(el => getComputedStyle(el.nextElementSibling!).backgroundColor),
    };
    await page.keyboard.press("Escape");
    return colours;
}

test("controls keep one accent while each tab's chart marks its selection in that pattern's Accent", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 2, 2);
    const untitledAccent = await page.getByLabel("Accent", { exact: true }).inputValue();
    const controls = await controlAccents(page);

    const accent = "#ff0066";
    expect(untitledAccent).not.toBe(accent);
    await page.getByRole("button", { name: "New tab" }).click();
    await page.getByLabel("Accent", { exact: true }).fill(accent);
    await page.keyboard.press("Escape");
    await clickCell(page, 2, 2);
    expect(await chartShows(page, accent)).toBe(true);
    expect(await chartShows(page, untitledAccent)).toBe(false);
    expect(await controlAccents(page)).toEqual(controls);

    await tab(page, "Untitled 1").click();
    expect(await chartShows(page, untitledAccent)).toBe(true);
    expect(await chartShows(page, accent)).toBe(false);
    expect(await controlAccents(page)).toEqual(controls);
});

// A motif with invalid placements in every row.
function warnedMotif(name: string) {
    const [w, h] = [12, 8];
    return { name, mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
        version: 1, state: { mode: "row", canvasWidth: w, canvasHeight: h },
        pixels: Array.from({ length: w * h }, (_, i) => {
            const x = i % w, y = Math.floor(i / w);
            return ((x + y) % 6 < 3) !== (y % 2 === 0) ? 1 : 2;
        }),
        colorA: "#123456", colorB: "#ffffff",
    })) };
}

async function controlDangers(page: Page) {
    return page.locator("#edit-error").evaluate(el => {
        const style = getComputedStyle(el);
        return [style.borderTopColor, style.backgroundColor];
    });
}

test("controls keep one danger colour while each tab's chart and Crochet list warn in that pattern's Danger", async ({ page }) => {
    await bootApp(page);
    for (const [name, danger] of [["red.mcw", "#ff0000"], ["magenta.mcw", "#ff00ff"]]) {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Open", exact: true }).click();
        await (await chooser).setFiles(warnedMotif(name));
        await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
        await page.getByRole("button", { name: "Pattern", exact: true }).click();
        await page.getByLabel("Danger", { exact: true }).fill(danger);
        await page.keyboard.press("Escape");
    }
    const crochetWarning = async () => {
        await page.getByRole("tab", { name: "Crochet", exact: true }).click();
        const colour = await page.locator(".instructions-unit--invalid").first()
            .evaluate(el => getComputedStyle(el).borderRightColor);
        await page.getByRole("tab", { name: "Design", exact: true }).click();
        return colour;
    };

    expect(await chartShows(page, "#ff00ff")).toBe(true);
    const controls = await controlDangers(page);
    expect(await crochetWarning()).toBe("rgb(255, 0, 255)");

    await tab(page, "red.mcw").click();
    expect(await chartShows(page, "#ff0000")).toBe(true);
    expect(await chartShows(page, "#ff00ff")).toBe(false);
    expect(await controlDangers(page)).toEqual(controls);
    expect(await crochetWarning()).toBe("rgb(255, 0, 0)");
});

test("a selection alone marks its tab unsaved until undone", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await expect(tab(page, "Untitled 1")).toHaveAccessibleName("Untitled 1, unsaved changes");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(tab(page, "Untitled 1")).toHaveAccessibleName("Untitled 1");
});

test("a reload restores every open tab and selects the active one", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await newTab(page);
    await openExample(page);
    await tab(page, "Untitled 2").click();

    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    await expect(tabs(page)).toHaveText([/^Untitled 1/, "Untitled 2", "Example"]);
    await expect(tab(page, "Untitled 1")).toHaveAccessibleName("Untitled 1, unsaved changes");
    await expect(tab(page, "Untitled 2")).toHaveAttribute("aria-selected", "true");
    await tab(page, "Untitled 1").click();
    expect(await cellRGB(page, 0, 1)).toEqual(A);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await cellRGB(page, 0, 1)).toEqual(B);
});

test("a reload closes a tab whose browser records are missing and says so", async ({ page }) => {
    await bootApp(page);
    await openMotif(page);
    await deleteStoredRecovery(page, await activeProjectId(page));
    await newTab(page);

    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    await expect(tabs(page)).toHaveText(["Untitled 1", "Untitled 2"]);
    await expect(page.getByRole("status").filter({ hasText: "motif.mcw" })).toContainText("couldn’t be recovered");
});

test("closing a clean tab needs no answer", async ({ page }) => {
    await bootApp(page);
    await newTab(page);
    await page.getByRole("button", { name: "Close Untitled 2" }).click();
    await expect(tabs(page)).toHaveText(["Untitled 1"]);
    await expect(tab(page, "Untitled 1")).toHaveAttribute("aria-selected", "true");
});

test("one click closes a tab while a Pattern change is pending", async ({ page }) => {
    await bootApp(page);
    await newTab(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#edit-width").fill("5");
    await page.getByRole("button", { name: "Close Untitled 1" }).click();
    await expect(tabs(page)).toHaveText([/^Untitled 2/]);
});

test("closing the last tab leaves the empty workspace, where nothing needs a pattern", async ({ page }) => {
    const errors: Error[] = [];
    page.on("pageerror", error => errors.push(error));
    await bootApp(page);
    await page.getByRole("button", { name: "Close Untitled 1" }).focus();
    await page.keyboard.press("Enter");

    await expect(tabs(page)).toHaveCount(0);
    await expect(emptyWorkspace(page)).toBeVisible();
    await expect(page.getByRole("button", { name: "New tab" })).toBeFocused();
    await expect(page.getByRole("navigation", { name: "Authoring tools" })).toBeHidden();
    await expect(page.getByRole("img", { name: "Editable pattern chart" })).toBeHidden();
    await expect(emptyWorkspace(page)).toContainText("its own tab");
    await expect(emptyWorkspace(page)).toContainText("shared by every tab");
    for (const name of ["Pattern", "Save", "Undo", "Redo"]) {
        await expect(page.getByRole("button", { name, exact: true })).toBeHidden();
    }
    for (const name of ["Design", "Crochet"]) await expect(page.getByRole("tab", { name, exact: true })).toBeHidden();
    await expect(page.locator("#document-bar")).toBeHidden();
    await expect(page.locator("#btn-load")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    for (const key of ["p", "s", "v", "r", "Control+a", "Control+z", "Control+v"]) await page.keyboard.press(key);
    await expect(tabs(page)).toHaveCount(0);
    expect(await storedProjectIds(page)).toEqual([]);
    expect(errors).toEqual([]);
});

test("the phone Menu offers only commands for every pattern while no pattern is open", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootApp(page);
    await page.getByRole("button", { name: "Close Untitled 1" }).click();
    await page.getByRole("button", { name: "Menu" }).click();
    await expect(page.getByRole("menuitem")).toHaveText(["Open", "Settings"]);
    await expect(page.getByRole("group", { name: "This pattern" })).toBeHidden();
});

test("New, Open and Example in the empty workspace each open the first tab", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Close Untitled 1" }).click();

    await emptyWorkspace(page).getByRole("button", { name: "New" }).click();
    await expect(tabs(page)).toHaveText(["Untitled 1"]);
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: "Close Untitled 1" }).click();

    const chooser = page.waitForEvent("filechooser");
    await emptyWorkspace(page).getByRole("button", { name: "Open" }).click();
    await (await chooser).setFiles({ name: "motif.mcw", mimeType: "application/json", buffer: Buffer.from(motif) });
    await expect(tabs(page)).toHaveText(["motif.mcw"]);
    expect(await cellRGB(page, 0, 0)).toEqual([18, 52, 86]);
    await page.getByRole("button", { name: "Close motif.mcw" }).click();

    await emptyWorkspace(page).getByRole("button", { name: "Example" }).click();
    await expect(tabs(page)).toHaveText(["Example"]);
    await expect(emptyWorkspace(page)).toBeHidden();
});

test("a reload keeps the empty workspace", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Close Untitled 1" }).click();
    await expect(emptyWorkspace(page)).toBeVisible();

    await page.reload();
    await expect(emptyWorkspace(page)).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    expect(await storedProjectIds(page)).toEqual([]);
});

test("a reload that recovers no tab shows the empty workspace and says what was closed", async ({ page }) => {
    await bootApp(page);
    await deleteStoredRecovery(page, await activeProjectId(page));

    await page.reload();
    await expect(emptyWorkspace(page)).toBeVisible();
    await expect(tabs(page)).toHaveCount(0);
    await expect(page.getByRole("status").filter({ hasText: "Untitled 1" })).toContainText("couldn’t be recovered");
});

test.describe("closing an unsaved tab", () => {
    // Untitled 1 has an unsaved stroke and Crochet progress, and Untitled 3 is active.
    async function unsavedTab(page: Page) {
        await bootApp(page);
        await page.keyboard.press("p");
        await clickCell(page, 0, 1);
        await page.locator("#view-crochet").click();
        await page.getByRole("button", { name: "Forward one row" }).click();
        await expect.poll(() => storedLiveProgress(page)).not.toBeNull();
        const id = await activeProjectId(page);
        await newTab(page);
        await newTab(page);
        await page.getByRole("button", { name: "Close Untitled 1" }).click();
        const prompt = page.getByRole("dialog", { name: "Save changes to “Untitled 1”?" });
        await expect(prompt).toBeVisible();
        await expect(prompt).toContainText("undo history");
        await expect(tab(page, "Untitled 1")).toHaveAttribute("aria-selected", "true");
        return { id, prompt };
    }

    test("Cancel keeps it open with its changes", async ({ page }) => {
        const { prompt } = await unsavedTab(page);
        await prompt.getByRole("button", { name: "Cancel" }).click();
        await expect(prompt).toBeHidden();
        await expect(tabs(page)).toHaveText([/^Untitled 1/, "Untitled 2", "Untitled 3"]);
        await expect(tab(page, "Untitled 3")).toHaveAttribute("aria-selected", "true");
        await tab(page, "Untitled 1").click();
        await page.locator("#view-design").click();
        expect(await cellRGB(page, 0, 1)).toEqual(A);
    });

    test("Close without saving discards it with its records and progress", async ({ page }) => {
        const { id, prompt } = await unsavedTab(page);
        expect(await storedProjectIds(page)).toContain(id);
        await prompt.getByRole("button", { name: "Close without saving" }).click();
        await expect(tabs(page)).toHaveText(["Untitled 2", "Untitled 3"]);
        await expect(tab(page, "Untitled 3")).toHaveAttribute("aria-selected", "true");
        expect(await storedProjectIds(page)).not.toContain(id);
        expect(await page.evaluate(id => localStorage.getItem(`mosaic-live-progress:${id}`), id)).toBeNull();
    });

    test("Save… closes it once the file is saved", async ({ page }) => {
        const { prompt } = await unsavedTab(page);
        await page.evaluate(() => { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
        const downloading = page.waitForEvent("download");
        await prompt.getByRole("button", { name: "Save…" }).click();
        await downloading;
        await expect(tabs(page)).toHaveText(["Untitled 2", "Untitled 3"]);
    });

    test("Close without saving the last tab leaves the empty workspace", async ({ page }) => {
        await bootApp(page);
        await page.keyboard.press("p");
        await clickCell(page, 0, 1);
        await page.getByRole("button", { name: "Close Untitled 1" }).click();
        await page.getByRole("dialog", { name: "Save changes to “Untitled 1”?" })
            .getByRole("button", { name: "Close without saving" }).click();
        await expect(tabs(page)).toHaveCount(0);
        await expect(emptyWorkspace(page)).toBeVisible();
        expect(await storedProjectIds(page)).toEqual([]);
    });

    test("Save… keeps it open when saving is cancelled", async ({ page }) => {
        const { prompt } = await unsavedTab(page);
        await page.evaluate(() => Object.assign(window, {
            showSaveFilePicker: () => Promise.reject(new DOMException("cancelled", "AbortError")),
        }));
        await prompt.getByRole("button", { name: "Save…" }).click();
        await expect(prompt).toBeHidden();
        await expect(tabs(page)).toHaveText([/^Untitled 1/, "Untitled 2", "Untitled 3"]);
    });
});

test("arrow, Home and End keys move between tabs", async ({ page }) => {
    await bootApp(page);
    await newTab(page);
    await openExample(page);
    await tab(page, "Example").focus();

    await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Untitled 1")).toBeFocused();
    await expect(tab(page, "Untitled 1")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(tab(page, "Example")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("Home");
    await expect(tab(page, "Untitled 1")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("End");
    await expect(tab(page, "Example")).toHaveAttribute("aria-selected", "true");
    await expect(tab(page, "Example")).toBeFocused();
    await expect(tabs(page)).toHaveText(["Untitled 1", "Untitled 2", "Example"]);
});

test("the tab strip scrolls sideways on a phone without widening the page", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootApp(page);
    for (let i = 0; i < 5; i++) await newTab(page);
    const strip = page.locator("#project-tabs");
    expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    expect(await page.evaluate(() => document.body.scrollWidth <= document.body.clientWidth)).toBe(true);
    await expect(tab(page, "Untitled 6")).toBeInViewport();
});

test("New tab stays whole and the strip scrolls whole tabs into view on a phone with doubled text", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootApp(page);
    await page.evaluate(() => {
        document.documentElement.style.fontSize = "200%";
        window.dispatchEvent(new Event("resize"));
    });
    const plus = page.getByRole("button", { name: "New tab" });
    const expectWhole = async () => {
        const box = (await plus.boundingBox())!;
        // Inset from the corners, which the button's rounding leaves to its parent.
        const [left, right, top, bottom] = [box.x + box.width * 0.2, box.x + box.width * 0.8, box.y + box.height * 0.2, box.y + box.height * 0.8];
        const corners = [[left, top], [right, top], [left, bottom], [right, bottom]];
        for (const [x, y] of corners) {
            expect(await page.evaluate(([x, y]) => document.elementFromPoint(x, y)?.closest("#tab-new") !== null, [x, y])).toBe(true);
        }
    };
    await expectWhole();
    for (let i = 0; i < 5; i++) await newTab(page);
    await expectWhole();
    const strip = page.locator("#project-tabs");
    expect(await strip.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);
    await expect(tab(page, "Untitled 6")).toBeInViewport();
    await strip.evaluate(el => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }));
    const end = await page.getByRole("button", { name: "Close Untitled 6" }).evaluate(close => {
        const r = close.getBoundingClientRect(), s = close.closest("#project-tabs")!.getBoundingClientRect();
        return r.left >= s.left && r.right <= s.right + 0.5;
    });
    expect(end).toBe(true);

    await tab(page, "Untitled 6").focus();
    await page.keyboard.press("Home");
    for (let i = 0; i < 2; i++) await page.keyboard.press("ArrowRight");
    await expect(tab(page, "Untitled 3")).toHaveAttribute("aria-selected", "true");
    // Scrolled back part way, the strip still never shows a close button without its tab.
    await strip.evaluate(el => el.scrollBy({ left: -20, behavior: "instant" }));
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const orphans = await page.evaluate(() => {
        const visible = document.getElementById("project-tabs")!.getBoundingClientRect();
        const shows = (el: Element) => { const r = el.getBoundingClientRect(); return r.right > visible.left + 1 && r.left < visible.right - 1; };
        return [...document.querySelectorAll<HTMLElement>(".project-tab-close")]
            .filter(close => shows(close) && !shows(document.getElementById(`project-tab-${close.dataset.project}`)!))
            .map(close => close.getAttribute("aria-label"));
    });
    expect(orphans).toEqual([]);
});

test("a tab strip scrolled to its end never shows a close button without its tab", async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await bootApp(page);
    const strip = page.locator("#project-tabs");
    for (const name of ["Tulip border", "Chevron blanket", "Mitten cuff", "Star medallion"]) {
        const chooser = page.waitForEvent("filechooser");
        await page.getByRole("button", { name: "Menu" }).click();
        await page.getByRole("menuitem", { name: "Open" }).click();
        await (await chooser).setFiles({ name: `${name}.mcw`, mimeType: "application/json", buffer: Buffer.from(motif) });
        await expect(tab(page, name)).toHaveAttribute("aria-selected", "true");
        await strip.evaluate(el => el.scrollTo({ left: el.scrollWidth, behavior: "instant" }));
        await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
        const orphans = await page.evaluate(() => {
            const visible = document.getElementById("project-tabs")!.getBoundingClientRect();
            const shows = (el: Element) => {
                const r = el.getBoundingClientRect();
                return el.checkVisibility({ visibilityProperty: true }) && r.right > visible.left + 1 && r.left < visible.right - 1;
            };
            return [...document.querySelectorAll<HTMLElement>(".project-tab-close")]
                .filter(close => shows(close) && !shows(document.getElementById(`project-tab-${close.dataset.project}`)!))
                .map(close => close.getAttribute("aria-label"));
        });
        expect(orphans, name).toEqual([]);
    }
});
