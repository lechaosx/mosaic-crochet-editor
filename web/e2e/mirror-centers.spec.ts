import { test, expect } from "@playwright/test";
import { addGlobalMirror, bootApp, cellCoord, clickCell, dragCells, chooseToolVariant, pixelRGB } from "./_helpers";

test("dragging a mirror handle with Duplicate preserves the lifted source and canvas", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await chooseToolVariant(page, "Move", "Duplicate");
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const before = await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return { pixels: s.document.pixels, float: s.workspace.float, recipes: s.workspace.recipes };
    });
    await dragCells(page, 4, 4, 3, 4);
    expect(await page.evaluate(() => {
        const s = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return { pixels: s.document.pixels, float: s.workspace.float, recipes: s.workspace.recipes };
    })).toEqual(before);
});

test("mirror center has independent types and disables parity-incompatible types", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const row = page.getByRole("group", { name: "Selected mirror centre", exact: true });
    await row.getByRole("spinbutton", { name: "Mirror centre x" }).fill("3.5");
    await row.getByRole("spinbutton", { name: "Mirror centre x" }).press("Enter");
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Point reflection (180°)", exact: true }).click();
    for (const name of ["Diagonal", "Anti-diagonal"]) await expect(page.locator(".sym-list-row.is-selected").getByRole("button", { name, exact: true })).toBeDisabled();
    await expect(page.locator("#transform-error")).toBeHidden();
    await expect(row.getByRole("spinbutton", { name: "Mirror centre x" })).toHaveValue("3.5");
    await expect(row.getByRole("spinbutton", { name: "Mirror centre y" })).toHaveValue("4");
    await row.getByRole("spinbutton", { name: "Mirror centre y" }).fill("3.5");
    await row.getByRole("spinbutton", { name: "Mirror centre y" }).press("Enter");
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Diagonal", exact: true }).click();
    await expect(page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Diagonal", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("only the center handle drags while the mirror inspector is open, with one undo and cancellation", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);
    await dragCells(page, 4, 4, 2, 3);
    await expect(x).toHaveValue("2");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(before);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(x).toHaveValue("4");
    await dragCells(page, 4, 1, 2, 1);
    await expect(x).toHaveValue("4");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    const start = await cellCoord(page, 4, 4), end = await cellCoord(page, 1, 4);
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    await page.locator("#btn-sym-toggle").click();
    await expect(x).toHaveValue("4");
    await page.locator("#btn-sym-toggle").click();
    await clickCell(page, 4, 4);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0].x)).toBe(4);
});

test("Move area can drag a mirror center with a wholly off-chart source", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.keyboard.press("m");
    await page.keyboard.press("Shift+ArrowLeft");
    await chooseToolVariant(page, "Move", "Move area");
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    await dragCells(page, 4, 4, 2, 3);
    await expect(page.getByRole("spinbutton", { name: "Mirror centre x" })).toHaveValue("2");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.float.x)).toBe(-4);
});

test("a mirror row action settles a held center drag before cancellation and has its own undo", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const start = await cellCoord(page, 4, 4), end = await cellCoord(page, 2, 4);
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.locator("[data-mirror-action='toggle']").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 2, enabled: false });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 2, enabled: true });
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0].x)).toBe(4);
});

test("unusable numeric coordinates retain the last valid centre and selected axes", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    const y = page.getByRole("spinbutton", { name: "Mirror centre y" });
    await y.fill("100");
    await y.press("Enter");
    await expect(y).toHaveValue("4");
    await expect(x).toHaveValue("4");
    await page.getByRole("button", { name: "Vertical", exact: true }).click();
    await x.fill("4"); await x.press("Enter");
    await y.fill("4"); await y.press("Enter");
    await page.getByRole("button", { name: "Diagonal", exact: true }).click();
    await x.fill("10"); await x.press("Enter");
    await expect(x).toHaveValue("4");
    await expect(y).toHaveValue("4");
    expect(await page.evaluate(() => {
        const m = JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0];
        return m.x - m.y;
    })).toBe(0);
});

test("an unavailable typed shortcut retains a held cancellable stroke on a one-cell chart", async ({ page }) => {
    await bootApp(page);
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    await (await chooser).setFiles({ name: "one-cell.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
        version: 1, state: { mode: "row", canvasWidth: 1, canvasHeight: 1 }, pixels: [2], colorA: "#000000", colorB: "#ffffff",
    })) });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.state))
        .toMatchObject({ canvasWidth: 1, canvasHeight: 1 });
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    const start = await cellCoord(page, 0, 0);
    const before = await pixelRGB(page, start.cx, start.cy);
    const pixels = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    expect(await pixelRGB(page, start.cx, start.cy)).not.toEqual(before);
    await page.keyboard.press("v");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.mouse.up();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(pixels);
    const restored = await cellCoord(page, 0, 0);
    expect(await pixelRGB(page, restored.cx, restored.cy)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
    await page.keyboard.press("Escape");
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await expect(page.locator(".sym-list-row")).toHaveCount(1);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 0, y: 0, enabled: true, types: [] });
});

test("centre hit targets stay screen-sized when zoomed out and dragging follows the rotated chart", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const zoomOut = page.getByRole("button", { name: "Zoom out", exact: true });
    for (let i = 0; i < 12; i++) await zoomOut.click();
    const start = await cellCoord(page, 4, 4), end = await cellCoord(page, 2, 4);
    await page.mouse.move(start.cx + 18, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx + 18, end.cy, { steps: 5 }); await page.mouse.up();
    await expect(page.getByRole("spinbutton", { name: "Mirror centre x" })).toHaveValue("2");
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    await page.getByRole("button", { name: "Rotate view right", exact: true }).click();
    await page.waitForTimeout(350);
    await dragCells(page, 2, 4, 5, 2);
    await expect(page.getByRole("spinbutton", { name: "Mirror centre x" })).toHaveValue("5");
    await expect(page.getByRole("spinbutton", { name: "Mirror centre y" })).toHaveValue("2");
});

for (const action of ["toggle", "delete", "type", "coordinate"] as const) {
    test(`accepted mirror ${action} settles held paint as a separate undoable edit`, async ({ page }) => {
        await bootApp(page);
        await page.locator("#btn-sym-toggle").click();
        await addGlobalMirror(page, "Vertical");
        const start = await cellCoord(page, 1, 1);
        const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);
        await page.mouse.move(start.cx, start.cy); await page.mouse.down();
        if (action === "coordinate") {
            const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
            await x.fill("3"); await x.press("Enter");
        } else {
            const button = action === "type" ? page.getByRole("button", { name: "Horizontal", exact: true })
                : page.locator(`[data-mirror-action='${action}']`);
            await button.focus(); await page.keyboard.press(action === "toggle" ? "Space" : "Enter");
        }
        await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
        const painted = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels);
        expect(painted).not.toEqual(before);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(painted);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(before);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(painted);
    });
}

test("rejected numeric edit leaves a held centre drag cancellable", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    const start = await cellCoord(page, 4, 4), end = await cellCoord(page, 2, 4);
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    await x.fill("0"); await x.press("Enter");
    await expect(x).toHaveValue("2");
    await page.evaluate(() => window.dispatchEvent(new Event("blur"))); await page.mouse.up();
    await expect(x).toHaveValue("4");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
});

test("paired numeric coordinates reach diagonal half parity in one action and reject incompatible pairs", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Diagonal");
    await page.getByRole("button", { name: "Anti-diagonal", exact: true }).click();
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    const y = page.getByRole("spinbutton", { name: "Mirror centre y" });
    const history = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length);
    await x.fill("3.5"); await y.fill("3.5");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 4, y: 4, types: ["D1", "D2"] });
    await y.press("Enter");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 3.5, y: 3.5, types: ["D1", "D2"] });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length)).toBe(history + 1);
    await x.fill("3"); await y.press("Enter");
    await expect(x).toHaveValue("3.5"); await expect(y).toHaveValue("3.5");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length)).toBe(history + 1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(x).toHaveValue("4"); await expect(y).toHaveValue("4");
});

test("composed mirror drawing survives a new-format Save, Open, and recovery reload", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    await page.getByRole("button", { name: "Horizontal", exact: true }).click();
    await clickCell(page, 1, 1);
    for (const [x, y] of [[1, 1], [7, 1], [1, 7], [7, 7]]) {
        const point = await cellCoord(page, x, y);
        expect(await pixelRGB(page, point.cx, point.cy)).toEqual([0, 0, 0]);
    }
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
    await page.evaluate(() => {
        const target = window as unknown as { savedMcw?: string; showSaveFilePicker?: () => Promise<unknown> };
        target.showSaveFilePicker = async () => ({ createWritable: async () => ({
            write: async (source: string) => { target.savedMcw = source; }, close: async () => {},
        }) });
    });
    await page.locator("#btn-save").click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { savedMcw?: string }).savedMcw)).toBeTruthy();
    const saved = await page.evaluate(() => (window as unknown as { savedMcw: string }).savedMcw);
    expect(JSON.parse(saved)).toMatchObject({ version: 6, mirrors: before.workspace.mirrors });
    await page.locator("[data-mirror-action='toggle']").locator("..").click();
    const chooser = page.waitForEvent("filechooser"); await page.locator("#btn-load").click();
    await (await chooser).setFiles({ name: "composed-centre.mcw", mimeType: "application/json", buffer: Buffer.from(saved) });
    await expect.poll(() => page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors)).toEqual(before.workspace.mirrors);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels)).toEqual(before.document.pixels);
    await page.reload(); await page.waitForFunction(() => !!window.__test_matrix__);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors)).toEqual(before.workspace.mirrors);
});

for (const width of [1280, 390]) {
    test(`malformed mirror import feedback preserves absolute rotated chart geometry and authored state at ${width}px`, async ({ page }) => {
        await page.setViewportSize({ width, height: 844 });
        await bootApp(page);
        await clickCell(page, 1, 1);
        await page.locator("#btn-sym-toggle").click();
        await addGlobalMirror(page, "Vertical");
        await page.getByRole("button", { name: "Rotate view right", exact: true }).click();
        await page.waitForTimeout(350);
        await page.getByRole("button", { name: "Zoom in", exact: true }).click();
        const before = await page.evaluate(() => ({ recovery: localStorage.getItem("mosaic-recovery"), history: localStorage.getItem("mosaic-history") }));
        const rect = await page.locator("#canvas").boundingBox();
        const centre = await cellCoord(page, 4, 4);
        const recovery = JSON.parse(before.recovery!);
        const mirror = recovery.workspace.mirrors[0];
        const chooser = page.waitForEvent("filechooser");
        if (await page.locator("#btn-load").isVisible()) await page.locator("#btn-load").click();
        else {
            await page.getByRole("button", { name: "Menu", exact: true }).click();
            await page.getByRole("menuitem", { name: "Open", exact: true }).click();
        }
        await (await chooser).setFiles({ name: "duplicate-mirrors.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
            version: 5, ...recovery.document, mirrors: [mirror, mirror],
        })) });
        await expect(page.locator("#document-error")).toBeVisible();
        expect(await page.evaluate(() => ({ recovery: localStorage.getItem("mosaic-recovery"), history: localStorage.getItem("mosaic-history") }))).toEqual(before);
        expect(await page.locator("#canvas").boundingBox()).toEqual(rect);
        expect(await cellCoord(page, 4, 4)).toEqual(centre);
        await page.getByRole("button", { name: "Dismiss document error", exact: true }).click();
        expect(await page.locator("#canvas").boundingBox()).toEqual(rect);
        expect(await cellCoord(page, 4, 4)).toEqual(centre);
    });
}

test("global type availability follows centre drafts, edges, cancellation, and Undo", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    const row = page.locator(".sym-list-row.is-selected");
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    const y = page.getByRole("spinbutton", { name: "Mirror centre y" });
    const axis = (name: string) => row.getByRole("button", { name, exact: true });
    await x.fill("0");
    await expect(axis("Vertical")).toBeDisabled();
    await expect(axis("Point reflection (180°)")).toBeDisabled();
    for (const name of ["Horizontal", "Diagonal", "Anti-diagonal"]) await expect(axis(name)).toBeEnabled();
    await x.press("Escape");
    await expect(axis("Vertical")).toBeEnabled();
    await axis("Diagonal").click();
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    await x.fill("3.5");
    await expect(axis("Anti-diagonal")).toBeDisabled();
    await expect(axis("Diagonal")).toBeEnabled();
    const disabled = (await axis("Anti-diagonal").boundingBox())!;
    await page.mouse.click(disabled.x + disabled.width / 2, disabled.y + disabled.height / 2);
    await expect(x).toHaveValue("3.5");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0].types)).toEqual(["D1"]);
    for (const name of ["Vertical", "Horizontal", "Point reflection (180°)"]) await expect(axis(name)).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
    await x.press("Enter");
    await expect(x).toHaveValue("4");
    await expect(axis("Anti-diagonal")).toBeEnabled();
    await x.fill("3.5"); await y.fill("3.5"); await y.press("Enter");
    await expect(axis("Anti-diagonal")).toBeEnabled();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(x).toHaveValue("4");
    await x.fill("");
    await expect(axis("Vertical")).toBeDisabled();
    await expect(axis("Diagonal")).toBeEnabled();
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(axis("Vertical")).toBeEnabled();
});
