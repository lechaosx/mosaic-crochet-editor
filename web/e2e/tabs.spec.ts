// Open patterns as tabs: each keeps its own project, undo history, view and
// mode, while tools are shared.
import { test, expect, type Page } from "@playwright/test";
import { activeProjectId, bootApp, cellCoord, clickCell, deleteStoredRecovery, pixelRGB, storedLiveProgress, storedProjectIds,
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
    return page.getByRole("region", { name: "No pattern open" });
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
    await page.locator("#btn-export").click();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await expect(page.locator("#instructions-live-progress")).toHaveText("2 / 9");

    await newTab(page);
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#btn-export")).toHaveText("Begin Crocheting");
    expect(await camera(page)).not.toEqual(zoomed);
    expect(await cellRGB(page, 0, 1)).toEqual(B);
    expect((await storedRecovery(page)).workspace.float).toBeNull();
    await page.keyboard.press("m");

    await tab(page, "Untitled 1").click();
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#instructions-live-progress")).toHaveText("2 / 9");
    expect(await camera(page)).toEqual(zoomed);
    await page.locator("#btn-export").click();
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
    for (const name of ["Pattern", "Save", "Undo", "Redo", "Begin Crocheting"]) {
        await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await expect(page.locator("#btn-load")).toBeEnabled();
    await expect(page.getByRole("button", { name: "Settings" })).toBeEnabled();
    for (const key of ["p", "s", "v", "r", "Control+a", "Control+z", "Control+v"]) await page.keyboard.press(key);
    await expect(tabs(page)).toHaveCount(0);
    expect(await storedProjectIds(page)).toEqual([]);
    expect(errors).toEqual([]);
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
        await page.locator("#btn-export").click();
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
        await page.locator("#btn-export").click();
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
