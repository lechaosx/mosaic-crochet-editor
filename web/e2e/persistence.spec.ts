// Persistence + boot-time consistency checks.
import { test, expect, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { addUnlistedProject, blockProjectDatabase, bootApp, clickCell, cellCoord, countRecoveryWrites, dragCells, failNextHistoryWrite,
         failRecoveryWrites, loseProjectIndex, pixelRGB, upgradeProjectDatabase, storedHistory, storedHistoryIsClean, storedHistoryLength, storedProjectIds, storedRecovery } from "./_helpers";

const A: [number, number, number] = [0, 0, 0];
const B: [number, number, number] = [255, 255, 255];

async function cellRGB(page: Page, x: number, y: number) {
    const { cx, cy } = await cellCoord(page, x, y);
    return pixelRGB(page, cx, cy);
}

async function reloadApp(page: Page) {
    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
}

async function saveDownload(page: Page) {
    await page.evaluate(() => { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await downloading;
}

test("Save downloads no empty selection record and Open restores an editable unselected project", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 0, 1);
    await page.evaluate(() => { delete (window as unknown as { showSaveFilePicker?: unknown }).showSaveFilePicker; });
    const before = { recovery: await storedRecovery(page), history: await storedHistory(page) };
    const downloading = page.waitForEvent("download");
    await page.getByRole("button", { name: "Save", exact: true }).click();
    const download = await downloading;
    expect(download.suggestedFilename()).toBe("Untitled 2.mcw");
    const source = await readFile((await download.path())!, "utf8");
    expect(JSON.parse(source).recipes).toEqual([]);
    expect({ recovery: await storedRecovery(page), history: await storedHistory(page) }).toEqual(before);

    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await expect(page.getByRole("button", { name: "Selection 1 1 × 1", exact: true })).toBeVisible();
    const choosing = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await choosing).setFiles({ name: "compact.mcw", mimeType: "application/json", buffer: Buffer.from(source) });
    await expect(page.getByRole("button", { name: "Selection 1 1 × 1", exact: true })).toHaveCount(0);
    await expect(page.locator("#document-error")).toBeHidden();
    const cell = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual(A);
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await expect(page.getByRole("button", { name: "Selection 1 1 × 1", exact: true })).toBeVisible();
});

test("local recovery failure stays visible and does not imply an mcw save", async ({ page }) => {
    await failRecoveryWrites(page);

    await bootApp(page);
    const recoveryStatus = page.getByRole("status", { name: "Browser recovery" });
    await expect(recoveryStatus).toHaveText("Recovery failed");
    await expect(page.getByRole("button", { name: "Save" })).toBeVisible();
    await clickCell(page, 0, 1);
    await expect(recoveryStatus).toHaveText("Recovery failed");
});

test("continuous paint writes recovery once when the stroke completes", async ({ page }) => {
    const recoveryWrites = await countRecoveryWrites(page);
    await bootApp(page);
    const writesBefore = await recoveryWrites();
    const start = await cellCoord(page, 0, 1);
    const end = await cellCoord(page, 3, 1);

    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 10 });

    expect(await pixelRGB(page, end.cx, end.cy)).toEqual(A);
    expect(await recoveryWrites()).toBe(writesBefore);

    await page.mouse.up();
    expect(await recoveryWrites()).toBe(writesBefore + 1);

    await page.reload();
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    const restored = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, restored.cx, restored.cy)).toEqual(A);
});

test("a paint stroke that changes nothing in a selection writes no recovery", async ({ page }) => {
    const recoveryWrites = await countRecoveryWrites(page);
    await bootApp(page);
    await page.keyboard.press("s");
    await dragCells(page, 0, 0, 3, 1);
    await page.keyboard.press("p");
    const writesBefore = await recoveryWrites();

    // Row 0 already holds the primary yarn A.
    await dragCells(page, 0, 0, 3, 0);

    expect(await recoveryWrites()).toBe(writesBefore);
});

test("paint, reload, content survives via browser recovery", async ({ page }) => {
    await bootApp(page);
    // Paint a recognisable cell (0, 1) = primary A (cell baseline is B).
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    // Reload — vite preview serves the same bundle.
    await page.reload();
    // Wait for the app to fully re-render.
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    await expect(page.getByRole("status", { name: "Browser recovery" }))
        .toHaveText("Recovered");
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("active float survives a reload (it lives in SessionState)", async ({ page }) => {
    await bootApp(page);
    // Lift a cell so a float exists.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await page.mouse.down();
    const a = await cellCoord(page, 0, 1);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.up();
    // Reload.
    await page.reload();
    await page.waitForFunction(() => !!(window as { __test_matrix__?: DOMMatrix }).__test_matrix__);
    // Move tool should still find the float (drag it to verify).
    await page.keyboard.press("m");
    const src = await cellCoord(page, 0, 1);
    const dst = await cellCoord(page, 3, 1);
    await page.mouse.move(src.cx, src.cy);
    await page.mouse.down();
    await page.mouse.move(dst.cx, dst.cy, { steps: 5 });
    await page.mouse.up();
    // Anchor and verify the lifted content landed at (3, 1).
    await page.keyboard.press("Control+Shift+A");
    const c = await cellCoord(page, 3, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("__test_matrix__ stays fresh across view changes (rotation updates the matrix)", async ({ page }) => {
    await bootApp(page);
    const m1 = await page.evaluate(() => {
        const m = (window as { __test_matrix__?: DOMMatrix }).__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    // Rotate the canvas; the matrix's a/b/c/d coefficients should change.
    await page.keyboard.press("r");
    await page.waitForTimeout(400);   // let the animation settle
    const m2 = await page.evaluate(() => {
        const m = (window as { __test_matrix__?: DOMMatrix }).__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e, m.f];
    });
    // At least one rotation-related coefficient changed.
    const moved = m1.some((v, i) => Math.abs(v - m2[i]) > 1e-3);
    expect(moved).toBe(true);
});

test("rapid state changes during marching-ants animation don't tear: final state coherent", async ({ page }) => {
    // The marching-ants rAF loop reads `rs.lastStore` and the live float.
    // Synchronous state changes shouldn't leave the renderer in a bad
    // intermediate. We simulate by firing rapid Ctrl+Z/Ctrl+Y oscillations
    // while a selection is alive (marching-ants animating).
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    const a = await cellCoord(page, 0, 1);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.down();
    await page.mouse.up();
    // Fire 20 undo/redo cycles back-to-back.
    for (let i = 0; i < 20; i++) {
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+y");
    }
    // App should still respond; verify the canvas is renderable and the
    // last-known cell still has the painted colour.
    const c = await cellCoord(page, 0, 1);
    expect((await pixelRGB(page, c.cx, c.cy))).toEqual(A);
});

test("reload restores the document with its undo history", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await clickCell(page, 1, 1);
    await reloadApp(page);

    expect(await cellRGB(page, 1, 1)).toEqual(A);
    await page.keyboard.press("Control+z");
    expect(await cellRGB(page, 1, 1)).toEqual(B);
    expect(await cellRGB(page, 0, 1)).toEqual(A);
    await page.keyboard.press("Control+y");
    expect(await cellRGB(page, 1, 1)).toEqual(A);
});

test("an edit after undo deletes the stored snapshots it discards from redo", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    for (let x = 0; x < 3; x++) await clickCell(page, x, 1);
    expect(await storedHistoryLength(page)).toBe(4);
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+z");
    await clickCell(page, 4, 1);
    expect(await storedHistoryLength(page)).toBe(3);
});

test("the project is clean at its start, after Save, and after undoing back to the save, across reloads", async ({ page }) => {
    await bootApp(page);
    expect(await storedHistoryIsClean(page)).toBe(true);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    expect(await storedHistoryIsClean(page)).toBe(false);
    await saveDownload(page);
    await expect.poll(() => storedHistoryIsClean(page)).toBe(true);

    await clickCell(page, 1, 1);
    expect(await storedHistoryIsClean(page)).toBe(false);
    await page.keyboard.press("Control+z");
    expect(await storedHistoryIsClean(page)).toBe(true);
    await reloadApp(page);
    expect(await storedHistoryIsClean(page)).toBe(true);

    await page.keyboard.press("Control+z");
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    expect(await cellRGB(page, 0, 1)).toEqual(A);
    expect(await storedHistoryIsClean(page)).toBe(false);
});

test("without IndexedDB the failure stays visible and the whole undo history still works", async ({ page }) => {
    await blockProjectDatabase(page);
    await bootApp(page);
    const recoveryStatus = page.getByRole("status", { name: "Browser recovery" });
    await expect(recoveryStatus).toHaveText("Recovery failed");
    await page.keyboard.press("p");
    for (let x = 0; x < 4; x++) await clickCell(page, x, 1);
    await expect(recoveryStatus).toHaveText("Recovery failed");

    for (let i = 0; i < 4; i++) await page.keyboard.press("Control+z");
    for (let x = 0; x < 4; x++) expect(await cellRGB(page, x, 1)).toEqual(B);
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await page.keyboard.press("Control+y");
    expect(await cellRGB(page, 0, 1)).toEqual(A);
});

test("boot removes the single-session browser records", async ({ page }) => {
    const retired = ["mosaic-recovery", "mosaic-pattern-v4", "mosaic-history", "mosaic-history-v4", "mosaic-live-progress"];
    await page.addInitScript(keys => { for (const key of keys) localStorage.setItem(key, "{}"); }, retired);
    await bootApp(page);
    expect(await page.evaluate(keys => keys.map(key => localStorage.getItem(key)), retired)).toEqual(retired.map(() => null));
});

test("boot deletes the records of projects that are no longer open", async ({ page }) => {
    await bootApp(page);
    const open = await storedProjectIds(page);
    await addUnlistedProject(page, "closed");
    expect(await storedProjectIds(page)).toEqual([...open, "closed"].sort());
    await reloadApp(page);
    expect(await storedProjectIds(page)).toEqual(open);
});

test("a failed undo history write stays reported until a later write stores the whole history", async ({ page }) => {
    const failNextWrite = await failNextHistoryWrite(page);
    await bootApp(page);
    const recoveryStatus = page.getByRole("status", { name: "Browser recovery" });
    await failNextWrite();
    // Both yarn edits are issued before the first one's failure is known.
    await page.evaluate(() => {
        const yarn = document.getElementById("color-a") as HTMLInputElement;
        for (const value of ["#111111", "#222222"]) {
            yarn.value = value;
            yarn.dispatchEvent(new Event("input"));
            yarn.dispatchEvent(new Event("change"));
        }
    });
    await storedHistory(page);
    await expect(recoveryStatus).toHaveText("Recovery failed");

    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await expect(recoveryStatus).toBeHidden();
    await reloadApp(page);
    for (let i = 0; i < 3; i++) await page.keyboard.press("Control+z");
    await expect(page.locator("#color-a")).toHaveValue("#000000");
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
});

test("a newer app version can upgrade the project database while this one runs", async ({ page }) => {
    await bootApp(page);
    expect(await upgradeProjectDatabase(page)).toBe(true);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await expect(page.getByRole("status", { name: "Browser recovery" })).toHaveText("Recovery failed");
});

test("when the project index can't be stored, the failure shows and other projects' records are kept", async ({ page }) => {
    await bootApp(page);
    const projects = await storedProjectIds(page);
    await loseProjectIndex(page);
    await reloadApp(page);
    await expect(page.getByRole("status", { name: "Browser recovery" })).toHaveText("Recovery failed");
    expect(await storedProjectIds(page)).toEqual(projects);
});
