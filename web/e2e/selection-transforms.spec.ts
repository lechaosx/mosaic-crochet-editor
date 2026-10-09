import { expect, test, type Page } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB, selectionHandleCoords } from "./_helpers";

async function selection(page: Parameters<typeof bootApp>[0]) {
    await bootApp(page);
    await page.getByRole("button", { name: "Pencil", exact: true }).click();
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 3, 3);
    const at = await cellCoord(page, 3, 3);
    expect(await pixelRGB(page, at.cx, at.cy)).toEqual([0, 0, 0]);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await clickCell(page, 3, 3);
    await page.getByRole("button", { name: "Select", exact: true }).click();
}
async function category(page: Parameters<typeof bootApp>[0], name: string) {
    await page.locator("label").filter({ has: page.getByRole("radio", { name, exact: true }) }).click();
}
async function recipe(page: Parameters<typeof bootApp>[0]) {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0]);
}
async function touchDrag(page: Page, start: { cx: number; cy: number }, end: { cx: number; cy: number }) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", { type: "touchStart", touchPoints: [{ x: start.cx, y: start.cy, id: 0 }] });
    for (let step = 1; step <= 6; step++) await session.send("Input.dispatchTouchEvent", { type: "touchMove",
        touchPoints: [{ x: start.cx + (end.cx - start.cx) * step / 6, y: start.cy + (end.cy - start.cy) * step / 6, id: 0 }] });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
}

test("None keeps the source editable while every dormant transform is disabled", async ({ page }) => {
    await selection(page);
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-right").press("Enter");
    await category(page, "None");
    await page.getByRole("button", { name: "Pencil", exact: true }).click();
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 3, 3);
    const source = await cellCoord(page, 3, 3), dormant = await cellCoord(page, 4, 3);
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([255, 255, 255]);
    expect(await pixelRGB(page, dormant.cx, dormant.cy)).toEqual([255, 255, 255]);
    expect(await recipe(page)).toMatchObject({ mode: "none", right: 2, source: { x: 3, y: 3, mask: [1] } });
    await page.keyboard.press("Control+c");
    await page.keyboard.press("m");
    await page.keyboard.press("ArrowRight");
    expect((await recipe(page)).source.x).toBe(4);
});

test("Circle and Mirror retain independent centres and execute exclusive destinations", async ({ page }) => {
    await selection(page);
    await category(page, "Circle");
    await page.locator("#recipe-centre-x").fill("2");
    await page.locator("#recipe-centre-y").fill("2");
    await page.locator("#recipe-centre-y").press("Enter");
    await page.locator("#recipe-turn-90").check();
    await category(page, "Mirror");
    await page.locator("#recipe-mirror-centre-x").fill("2.5");
    await page.locator("#recipe-mirror-centre-y").fill("2.5");
    await page.locator("#recipe-mirror-centre-y").press("Enter");
    await page.locator("#recipe-mirror-v").click();
    await page.locator("#recipe-mirror-h").click();
    expect(await recipe(page)).toMatchObject({ mode: "mirror", mirrorCentreX: 2.5, mirrorCentreY: 2.5,
        mirrorTypes: ["V", "H"], source: { x: 3, y: 3 } });
    await page.locator("#recipe-apply").click();
    for (const [x, y] of [[2, 2], [3, 2], [2, 3], [3, 3]]) {
        const at = await cellCoord(page, x + 0.3, y);
        await expect.poll(() => pixelRGB(page, at.cx, at.cy), { message: `${x},${y}` }).toEqual([0, 0, 0]);
    }
    await category(page, "Circle");
    await expect(page.locator("#recipe-centre-x")).toHaveValue("2");
    await expect(page.locator("#recipe-centre-y")).toHaveValue("2");
    expect(await recipe(page)).toMatchObject({ mode: "circle", mirrorCentreX: 2.5, mirrorCentreY: 2.5, mirrorTypes: ["V", "H"] });
});

test("Grid step drag edits its field parameters and cancels back to the source configuration", async ({ page }) => {
    await selection(page);
    const [start] = await selectionHandleCoords(page);
    const source = await cellCoord(page, 3, 3), destination = await cellCoord(page, 5, 4);
    const end = { cx: start.cx + destination.cx - source.cx, cy: start.cy + destination.cy - source.cy };
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 8 });
    await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ columnSpacing: 2, columnSpacingAlternate: 2, columnOffset: 1,
        source: { x: 3, y: 3, mask: [1] }, right: 0 });
    await page.keyboard.press("Control+z");
    expect(await recipe(page)).toMatchObject({ columnSpacing: 0, columnOffset: 0 });
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 8 });
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ columnSpacing: 0, columnOffset: 0, source: { x: 3, y: 3 } });
});

test("legacy recovery conversion is an informational, dismissible notice without a history or camera edit", async ({ page }) => {
    await selection(page);
    await page.evaluate(() => {
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        recovery.version = 8;
        const old = recovery.workspace.recipes[0];
        old.mode = "rotation"; old.mirrorHorizontal = true; old.mirrorVertical = true;
        delete old.mirrorCentreX; delete old.mirrorCentreY; delete old.mirrorTypes;
        localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
    });
    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    const notice = page.getByRole("status").filter({ hasText: "Recovered selection transforms were converted" });
    await expect(notice).toBeVisible();
    const before = await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        matrix: Array.from(window.__test_matrix__!.toFloat64Array()) }));
    await page.getByRole("button", { name: "Dismiss document notice", exact: true }).click();
    await expect(notice).not.toBeVisible();
    expect(await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        matrix: Array.from(window.__test_matrix__!.toFloat64Array()) }))).toEqual(before);
    expect((await recipe(page)).mode).toBe("mirror");
});

test("paired Circle precision previews valid half-grid pairs and coalesces related edits", async ({ page }) => {
    await selection(page);
    await category(page, "Circle");
    await page.locator("#recipe-turn-90").check();
    const x = page.locator("#recipe-centre-x"), y = page.locator("#recipe-centre-y");
    for (const value of ["3.5", "4", "4.5"]) {
        await x.fill(value);
        await expect(page.locator("#recipe-error")).toBeHidden();
        await expect(x).toHaveValue(value);
        await y.fill(value);
        await y.press("Enter");
        expect(await recipe(page)).toMatchObject({ rotationCentreX: Number(value), rotationCentreY: Number(value) });
    }
    await x.fill("4.25");
    await x.press("Enter");
    await expect(x).toHaveValue("4.5");
    await expect(y).toHaveValue("4.5");
    await expect(page.locator("#recipe-error")).toContainText(/whole or half/i);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await recipe(page)).toMatchObject({ mode: "circle", rotationTurns: [90], rotationCentreX: 3, rotationCentreY: 3 });
    await x.fill("3.5"); await y.fill("3.5");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(x).toHaveValue("3");
    await expect(y).toHaveValue("3");
});

test("a deliberate category action settles a held local drag and has its own Undo", async ({ page }) => {
    await selection(page);
    const [start] = await selectionHandleCoords(page);
    const source = await cellCoord(page, 3, 3), destination = await cellCoord(page, 5, 4);
    const end = { cx: start.cx + destination.cx - source.cx, cy: start.cy + destination.cy - source.cy };
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.locator("#recipe-mode-none").focus();
    await page.keyboard.press("Space");
    await page.keyboard.press("Escape"); await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ mode: "none", columnSpacing: 2, columnOffset: 1 });
    await page.keyboard.press("Control+z");
    expect(await recipe(page)).toMatchObject({ mode: "grid", columnSpacing: 2, columnOffset: 1 });
    await page.keyboard.press("Control+z");
    expect(await recipe(page)).toMatchObject({ mode: "grid", columnSpacing: 0, columnOffset: 0 });
});

test("Stamp with no copies retains a held cancellable Grid preview without history", async ({ page }) => {
    await selection(page);
    const before = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    const [start] = await selectionHandleCoords(page);
    const source = await cellCoord(page, 3, 3), destination = await cellCoord(page, 5, 4);
    const end = { cx: start.cx + destination.cx - source.cx, cy: start.cy + destination.cy - source.cy };
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.locator("#recipe-apply").focus(); await page.keyboard.press("Space");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(before);
    await page.keyboard.press("Escape"); await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ mode: "grid", columnSpacing: 0, columnOffset: 0 });
});

test("accepted local Stamp settles a held Move and creates a distinct Undo", async ({ page }) => {
    await selection(page);
    await page.locator("#recipe-right").fill("1"); await page.locator("#recipe-right").press("Enter");
    await page.getByRole("button", { name: "Move", exact: true }).click();
    const start = await cellCoord(page, 3, 3), end = await cellCoord(page, 4, 3);
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.locator("#recipe-apply").focus(); await page.keyboard.press("Space");
    await page.locator("#canvas").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0 });
    await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ source: { x: 4, y: 3 } });
    const copy = await cellCoord(page, 5, 3);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([0, 0, 0]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await recipe(page)).toMatchObject({ source: { x: 4, y: 3 } });
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([255, 255, 255]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await recipe(page)).toMatchObject({ source: { x: 3, y: 3 } });
});

test("a pending overlapping Rectangle is rejected by Stamp without settling its gesture", async ({ page }) => {
    await selection(page);
    await category(page, "Mirror");
    await page.locator("#recipe-mirror-centre-x").fill("3.5");
    await page.locator("#recipe-mirror-centre-x").press("Enter");
    await page.locator("#recipe-mirror-v").click();
    const before = await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        recovery: localStorage.getItem("mosaic-recovery") }));
    const start = await cellCoord(page, 3, 3), end = await cellCoord(page, 4, 3);
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.locator("#recipe-apply").focus(); await page.keyboard.press("Space");
    expect(await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        recovery: localStorage.getItem("mosaic-recovery") }))).toEqual(before);
    await expect(page.locator("#recipe-error")).toBeHidden();
    await page.keyboard.press("Escape"); await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ mode: "mirror", source: { x: 3, y: 3, w: 1, mask: [1] }, mirrorTypes: ["V"] });
});

test("accepted Stamp uses the pending Rectangle source and leaves selection and stamp as separate Undo actions", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 3); await clickCell(page, 5, 3);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 3);
    await page.locator("#recipe-right").fill("1"); await page.locator("#recipe-right").press("Enter");
    const start = await cellCoord(page, 5, 3), end = await cellCoord(page, 6, 3);
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 });
    await page.locator("#recipe-apply").focus(); await page.keyboard.press("Space");
    await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ source: { x: 5, y: 3, w: 2, mask: [1, 1] } });
    const copy = await cellCoord(page, 7, 3);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([0, 0, 0]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await recipe(page)).toMatchObject({ source: { x: 5, y: 3, w: 2 } });
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([255, 255, 255]);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    expect(await recipe(page)).toMatchObject({ source: { x: 1, y: 3, w: 1 } });
});

test("Mirror precision accepts a paired half-grid diagonal centre and retains Circle independently", async ({ page }) => {
    await selection(page);
    await category(page, "Mirror");
    await page.locator("#recipe-mirror-d1").click();
    await page.locator("#recipe-mirror-centre-x").fill("3.5");
    await expect(page.locator("#recipe-error")).toBeHidden();
    await page.locator("#recipe-mirror-centre-y").fill("3.5");
    await page.locator("#recipe-mirror-centre-y").press("Enter");
    expect(await recipe(page)).toMatchObject({ mirrorCentreX: 3.5, mirrorCentreY: 3.5, rotationCentreX: 3, rotationCentreY: 3 });
    await page.locator("#recipe-mirror-centre-x").fill("4");
    await page.locator("#recipe-mirror-centre-x").press("Enter");
    await expect(page.locator("#recipe-mirror-centre-x")).toHaveValue("3.5");
    await category(page, "Circle"); await category(page, "Mirror");
    expect(await recipe(page)).toMatchObject({ mirrorCentreX: 3.5, mirrorCentreY: 3.5, mirrorTypes: ["D1"], rotationCentreX: 3 });
});

test("local Mirror describes implied types while buttons and history retain explicit choices", async ({ page }) => {
    await selection(page);
    await category(page, "Mirror");
    await page.locator("#recipe-mirror-v").click();
    await page.locator("#recipe-mirror-h").click();
    const point = page.getByRole("button", { name: "Point reflection (180°)", exact: true });
    await expect(point).toHaveAttribute("aria-pressed", "false");
    await expect(point).toHaveAccessibleDescription(/Implied/);
    expect((await recipe(page)).mirrorTypes).toEqual(["V", "H"]);
    const count = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length);
    await point.click();
    await expect(point).toHaveAttribute("aria-pressed", "true");
    expect((await recipe(page)).mirrorTypes).toEqual(["V", "H", "C"]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length)).toBe(count + 1);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(point).toHaveAttribute("aria-pressed", "false");
    await expect(point).toHaveAccessibleDescription(/Implied/);
    await page.locator("#recipe-mirror-h").click();
    await expect(point).not.toHaveAccessibleDescription(/Implied/);
    expect((await recipe(page)).mirrorTypes).toEqual(["V"]);
});

for (const ordering of ["independent choices", "recipe and source field keys"] as const) test(
    `identical Open ignores reordered ${ordering} without moving the rotated view`, async ({ page }) => {
    await selection(page);
    await category(page, "Circle");
    await page.locator("#recipe-turn-90").check(); await page.locator("#recipe-turn-270").check();
    await category(page, "Mirror");
    await page.locator("#recipe-mirror-centre-x").fill("2.5"); await page.locator("#recipe-mirror-centre-y").fill("2.5");
    await page.locator("#recipe-mirror-centre-y").press("Enter");
    await page.locator("#recipe-mirror-v").click(); await page.locator("#recipe-mirror-h").click();
    await page.evaluate(() => {
        const target = window as unknown as { savedMcw?: string; showSaveFilePicker?: () => Promise<unknown> };
        target.showSaveFilePicker = async () => ({ createWritable: async () => ({
            write: async (source: string) => { target.savedMcw = source; }, close: async () => {},
        }) });
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { savedMcw?: string }).savedMcw)).toBeTruthy();
    const file = JSON.parse(await page.evaluate(() => (window as unknown as { savedMcw: string }).savedMcw));
    if (ordering === "independent choices") {
        file.recipes[0].mirrorTypes.reverse(); file.recipes[0].rotationTurns.reverse();
    } else {
        file.recipes[0].source = Object.fromEntries(Object.entries(file.recipes[0].source).reverse());
        file.recipes[0] = Object.fromEntries(Object.entries(file.recipes[0]).reverse());
    }
    await page.getByRole("button", { name: "Rotate view right", exact: true }).click();
    await page.waitForFunction(() => Math.abs(window.__test_matrix__!.a - window.__test_matrix__!.b) < 1e-10);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const before = await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        recovery: localStorage.getItem("mosaic-recovery"), matrix: Array.from(window.__test_matrix__!.toFloat64Array()) }));
    await page.evaluate(() => {
        const read = FileReader.prototype.readAsText;
        FileReader.prototype.readAsText = function (...args) {
            this.addEventListener("loadend", () => { (window as unknown as { fileReadComplete: boolean }).fileReadComplete = true; }, { once: true });
            read.apply(this, args);
        };
    });
    const choosing = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await choosing).setFiles({ name: "same-choices.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    await page.waitForFunction(() => (window as unknown as { fileReadComplete: boolean }).fileReadComplete);
    await expect(page.locator("#document-error")).toBeHidden();
    expect(await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        recovery: localStorage.getItem("mosaic-recovery"), matrix: Array.from(window.__test_matrix__!.toFloat64Array()) }))).toEqual(before);
});

test("a successful legacy file conversion uses a neutral notice and keeps an identical project camera and history", async ({ page }) => {
    await selection(page); await category(page, "Circle");
    await page.locator("#recipe-centre-x").fill("2.5"); await page.locator("#recipe-centre-y").fill("2.5");
    await page.locator("#recipe-centre-y").press("Enter");
    await category(page, "Mirror");
    await page.locator("#recipe-mirror-centre-x").fill("2.5"); await page.locator("#recipe-mirror-centre-y").fill("2.5");
    await page.locator("#recipe-mirror-centre-y").press("Enter");
    await page.locator("#recipe-mirror-v").click(); await page.locator("#recipe-mirror-h").click();
    await page.evaluate(() => {
        const target = window as unknown as { savedMcw?: string; showSaveFilePicker?: () => Promise<unknown> };
        target.showSaveFilePicker = async () => ({ createWritable: async () => ({
            write: async (source: string) => { target.savedMcw = source; }, close: async () => {},
        }) });
    });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await expect.poll(() => page.evaluate(() => (window as unknown as { savedMcw?: string }).savedMcw)).toBeTruthy();
    const file = JSON.parse(await page.evaluate(() => (window as unknown as { savedMcw: string }).savedMcw));
    file.version = 5;
    file.recipes[0].mode = "rotation"; file.recipes[0].mirrorHorizontal = true; file.recipes[0].mirrorVertical = true;
    delete file.recipes[0].mirrorTypes; delete file.recipes[0].mirrorCentreX; delete file.recipes[0].mirrorCentreY;
    await page.getByRole("button", { name: "Rotate view right", exact: true }).click();
    await page.waitForFunction(() => Math.abs(window.__test_matrix__!.a - window.__test_matrix__!.b) < 1e-10);
    const before = await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        recovery: localStorage.getItem("mosaic-recovery"), matrix: Array.from(window.__test_matrix__!.toFloat64Array()) }));
    const choosing = page.waitForEvent("filechooser"); await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await choosing).setFiles({ name: "legacy-selection.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify(file)) });
    const notice = page.getByRole("status").filter({ hasText: "Saved selection transforms were converted" });
    await expect(notice).toBeVisible();
    await page.getByRole("button", { name: "Dismiss document notice", exact: true }).click();
    await expect(notice).toBeHidden();
    expect(await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"),
        recovery: localStorage.getItem("mosaic-recovery"), matrix: Array.from(window.__test_matrix__!.toFloat64Array()) }))).toEqual(before);
});

for (const cancellation of ["blur", "pointercancel", "lostpointercapture"] as const) {
    test(`${cancellation} restores a held Circle centre without authored history`, async ({ page }) => {
        await selection(page); await category(page, "Circle");
        const before = await page.evaluate(() => localStorage.getItem("mosaic-history"));
        const start = await cellCoord(page, 3, 3), end = await cellCoord(page, 4, 4);
        await page.mouse.move(start.cx, start.cy); await page.mouse.down();
        await page.mouse.move(end.cx, end.cy, { steps: 5 });
        if (cancellation === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        else await page.locator("#canvas").dispatchEvent(cancellation, { pointerId: 1, pointerType: "mouse", button: 0 });
        await page.mouse.up();
        expect(await recipe(page)).toMatchObject({ rotationCentreX: 3, rotationCentreY: 3, source: { x: 3, y: 3 } });
        expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(before);
    });
}

test("Circle handles are inactive during painting and Crochet while the chosen tool is retained", async ({ page }) => {
    await selection(page);
    await category(page, "Circle");
    await page.getByRole("button", { name: "Pencil", exact: true }).click();
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await clickCell(page, 3, 3);
    const at = await cellCoord(page, 3, 3);
    expect(await pixelRGB(page, at.cx, at.cy)).toEqual([255, 255, 255]);
    expect((await recipe(page)).rotationCentreX).toBe(3);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    const before = await recipe(page);
    await page.getByRole("button", { name: "Begin Crocheting", exact: true }).click();
    const start = await cellCoord(page, 3, 3), end = await cellCoord(page, 4, 4);
    await page.mouse.move(start.cx, start.cy); await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 5 }); await page.mouse.up();
    expect(await recipe(page)).toEqual(before);
    await page.getByRole("button", { name: "Back to Design", exact: true }).click();
    await expect(page.getByRole("button", { name: "Select", exact: true })).toHaveAttribute("aria-pressed", "true");
    const returned = await cellCoord(page, 3, 3), moved = await cellCoord(page, 4, 4);
    await page.mouse.move(returned.cx, returned.cy); await page.mouse.down();
    await page.mouse.move(moved.cx, moved.cy, { steps: 5 }); await page.mouse.up();
    expect(await recipe(page)).toMatchObject({ rotationCentreX: 4, rotationCentreY: 4, source: { x: 3, y: 3 } });
});

test.describe("high-DPI phone selection controls", () => {
    test.use({ viewport: { width: 414, height: 896 }, deviceScaleFactor: 3, isMobile: true, hasTouch: true, reducedMotion: "reduce" });

    test("rotated touch targets and coincident Grid steps remain independently editable", async ({ page }) => {
        await selection(page);
        await page.locator("#recipe-column-offset").fill("2"); await page.locator("#recipe-column-offset").press("Enter");
        await page.locator("#recipe-row-offset").fill("2"); await page.locator("#recipe-row-offset").press("Enter");
        await page.locator("#recipe-gap-x").fill("1"); await page.locator("#recipe-gap-x").press("Enter");
        await page.locator("#recipe-gap-y").fill("1"); await page.locator("#recipe-gap-y").press("Enter");
        await category(page, "None"); await category(page, "Grid");
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        await page.getByRole("button", { name: "Fit view", exact: true }).click();
        await page.getByRole("button", { name: "Rotate view right", exact: true }).click();
        await page.waitForFunction(() => Math.abs(window.__test_matrix__!.a - window.__test_matrix__!.b) < 1e-10);
        const [column] = await selectionHandleCoords(page);
        const origin = await cellCoord(page, 3, 3), columnEnd = await cellCoord(page, 4, 3);
        await touchDrag(page, { cx: column.cx + 12, cy: column.cy },
            { cx: column.cx + 12 + columnEnd.cx - origin.cx, cy: column.cy + columnEnd.cy - origin.cy });
        expect(await recipe(page)).toMatchObject({ columnSpacing: 2, columnOffset: 2, rowSpacing: 1, rowOffset: 2,
            source: { x: 3, y: 3, mask: [1] } });
        await page.getByRole("button", { name: "Undo", exact: true }).evaluate((button: HTMLButtonElement) => button.click());
        const [, row] = await selectionHandleCoords(page);
        const rowOrigin = await cellCoord(page, 3, 3), rowEnd = await cellCoord(page, 3, 4);
        await touchDrag(page, row, { cx: row.cx + rowEnd.cx - rowOrigin.cx, cy: row.cy + rowEnd.cy - rowOrigin.cy });
        expect(await recipe(page)).toMatchObject({ columnSpacing: 1, rowSpacing: 2, rowOffset: 2, source: { x: 3, y: 3 } });
    });

    test("source and generated outlines remain visible across zoom, yarns, and Accent palettes", async ({ page }) => {
        await selection(page);
        await page.locator("#recipe-right").fill("2"); await page.locator("#recipe-right").press("Enter");
        await page.locator("#recipe-down").fill("2"); await page.locator("#recipe-down").press("Enter");
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.float)).not.toBeNull();
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.float)).not.toBeNull();
        await page.getByRole("button", { name: "Fit view", exact: true }).click();
        await page.screenshot({ path: "/tmp/mosaic-selection-phone-default.png" });
        await page.getByRole("button", { name: "Zoom out", exact: true }).click();
        await page.getByRole("button", { name: "Zoom out", exact: true }).click();
        await page.screenshot({ path: "/tmp/mosaic-selection-phone-small.png" });
        await page.locator("#btn-edit").evaluate((button: HTMLButtonElement) => button.click());
        await page.locator("#accent-color").fill("#ffffff");
        await page.locator("#accent-color").dispatchEvent("change");
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        await page.screenshot({ path: "/tmp/mosaic-selection-phone-white.png" });
        await page.locator("#btn-edit").evaluate((button: HTMLButtonElement) => button.click());
        await page.locator("#accent-color").fill("#000000");
        await page.locator("#accent-color").dispatchEvent("change");
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        await page.screenshot({ path: "/tmp/mosaic-selection-phone-black.png" });
        expect((await recipe(page)).source).toMatchObject({ x: 3, y: 3, mask: [1] });
    });
});

test("local mirror availability follows drafts and preserves chosen removal and legal off-chart centres", async ({ page }) => {
    await selection(page);
    await category(page, "Mirror");
    const group = page.getByRole("group", { name: "Mirror types", exact: true });
    await expect(group.getByRole("button")).toHaveCount(5);
    await expect(page.getByRole("group", { name: "Reflection", exact: true })).toHaveCount(0);
    const x = page.locator("#recipe-mirror-centre-x");
    const y = page.locator("#recipe-mirror-centre-y");
    const diagonal = page.locator("#recipe-mirror-d1");
    const antiDiagonal = page.locator("#recipe-mirror-d2");
    await diagonal.click();
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    await x.fill("3.5");
    await expect(diagonal).toBeEnabled();
    await expect(antiDiagonal).toBeDisabled();
    const disabled = (await antiDiagonal.boundingBox())!;
    await page.mouse.click(disabled.x + disabled.width / 2, disabled.y + disabled.height / 2);
    await expect(x).toHaveValue("3.5");
    expect((await recipe(page)).mirrorTypes).toEqual(["D1"]);
    for (const name of ["Vertical", "Horizontal", "Point reflection (180°)"]) await expect(group.getByRole("button", { name, exact: true })).toBeEnabled();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
    await x.press("Escape");
    await expect(x).toHaveValue("3");
    await expect(y).toHaveValue("3");
    await expect(antiDiagonal).toBeEnabled();
    await x.fill("3.5"); await x.press("Enter");
    await expect(x).toHaveValue("3");
    await expect(antiDiagonal).toBeEnabled();
    await x.fill("3.5"); await y.fill("3.5"); await y.press("Enter");
    await expect(antiDiagonal).toBeEnabled();
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(x).toHaveValue("3");
    await diagonal.click();
    await x.fill("-4"); await x.press("Enter");
    await expect(x).toHaveValue("-4");
    await expect(page.locator("#recipe-mirror-v")).toBeEnabled();
    await page.locator("#recipe-mirror-v").click();
    expect(await recipe(page)).toMatchObject({ mirrorCentreX: -4, mirrorTypes: ["V"] });
});
