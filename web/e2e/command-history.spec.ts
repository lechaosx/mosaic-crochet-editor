import { expect, test, type Page } from "@playwright/test";
import { bootApp, cellCoord, clickCell, pixelRGB, chooseToolVariant } from "./_helpers";

async function recovery(page: Page) {
    return page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
}

async function camera(page: Page) {
    return page.evaluate(() => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const m = window.__test_matrix__!;
        return [m.a, m.b, m.c, m.d, m.e - canvas.width / 2, m.f - canvas.height / 2];
    });
}

async function selectForMove(page: Page, mode = "Move content") {
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await chooseToolVariant(page, "Move", mode);
    await page.getByRole("button", { name: "Close inspector" }).click();
    await page.locator("#canvas").focus();
}

test("Crochet Undo and Redo shortcuts execute the same commands as buttons", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.locator("#btn-export").click();
    await page.keyboard.press("Control+z");
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    const cell = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([255, 255, 255]);
    await page.locator("#btn-export").click();
    await page.keyboard.press("Control+y");
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([0, 0, 0]);
});

test("unavailable Undo and Redo leave Crochet open", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeDisabled();
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+y");
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "true");
});

test("About shields document shortcuts and Escape preserves the underlying Settings", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    const before = await recovery(page);
    await page.getByRole("button", { name: "Settings" }).click();
    await page.locator("#settings-about").click();
    await page.locator("#about-close").focus();
    await page.keyboard.press("Control+z");
    await page.keyboard.press("Control+a");
    await page.keyboard.press("m");
    expect(await recovery(page)).toEqual(before);
    await page.keyboard.press("Escape");
    await expect(page.locator("#about-dialog")).toBeHidden();
    await expect(page.locator("#hl-popover")).toBeVisible();
    await expect(page.locator("#settings-about")).toBeFocused();
    await page.keyboard.press("Escape");
    await expect(page.locator("#hl-popover")).toBeHidden();
});

test("Escape dismisses the compact menu before the underlying Settings", async ({ page }) => {
    await page.setViewportSize({ width: 360, height: 740 });
    await bootApp(page);
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.getByRole("menuitem", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Menu", exact: true }).click();
    await page.keyboard.press("Escape");
    await expect(page.locator("#more-popover")).toBeHidden();
    await expect(page.locator("#hl-popover")).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.locator("#hl-popover")).toBeHidden();
});

for (const mode of ["Move content", "Duplicate", "Move area"]) {
    test(`${mode} selected keyboard movement records the final held-arrow position`, async ({ page }) => {
        await bootApp(page);
        await selectForMove(page, mode);
        const before = await recovery(page);
        const historyBefore = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length);
        await page.keyboard.down("ArrowRight");
        await page.keyboard.down("ArrowRight");
        await page.keyboard.down("ArrowRight");
        await page.keyboard.up("ArrowRight");
        const after = await recovery(page);
        expect(after.workspace.float.x).toBe(4);
        const source = await cellCoord(page, 1, 1);
        const destination = await cellCoord(page, 4, 1);
        expect(await pixelRGB(page, source.cx, source.cy)).toEqual(mode === "Move content" ? [255, 255, 255] : [0, 0, 0]);
        expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual(mode === "Move area" ? [255, 255, 255] : [0, 0, 0]);
        expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length)).toBe(historyBefore + 1);
        await page.keyboard.press("Control+z");
        expect((await recovery(page)).workspace.float).toEqual(before.workspace.float);
        await page.keyboard.press("Control+y");
        expect((await recovery(page)).workspace.float).toEqual(after.workspace.float);
    });
}

test("keyboard Alt dominates Ctrl and blur cancels a held movement", async ({ page }) => {
    await bootApp(page);
    await selectForMove(page);
    const before = await recovery(page);
    await page.keyboard.down("Control");
    await page.keyboard.down("Alt");
    await page.keyboard.down("ArrowRight");
    const destination = await cellCoord(page, 2, 1);
    expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([255, 255, 255]);
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("Alt");
    await page.keyboard.up("Control");
    expect(await recovery(page)).toEqual(before);
});

test("Escape cancels held keyboard movement without anchoring or adding history", async ({ page }) => {
    await bootApp(page);
    await selectForMove(page, "Duplicate");
    const before = await recovery(page);
    await page.keyboard.down("ArrowRight");
    await page.keyboard.press("Escape");
    await page.keyboard.up("ArrowRight");
    expect(await recovery(page)).toEqual(before);
});

test("blur restores a held keyboard movement and permits the next move", async ({ page }) => {
    await bootApp(page);
    await selectForMove(page, "Duplicate");
    const before = await recovery(page);
    await page.keyboard.down("ArrowRight");
    await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await page.keyboard.up("ArrowRight");
    expect(await recovery(page)).toEqual(before);
    await page.keyboard.press("ArrowRight");
    expect((await recovery(page)).workspace.float.x).toBe(2);
});

for (const event of ["Escape", "blur"]) {
    test(`${event} cancels held keyboard movement while preserving current view and tool`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await bootApp(page);
        await selectForMove(page, "Duplicate");
        const before = await recovery(page);
        const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
        await page.keyboard.down("ArrowRight");
        await page.keyboard.press("r");
        await page.keyboard.press("p");
        await page.waitForTimeout(300);
        const view = await camera(page);
        if (event === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        else await page.keyboard.press("Escape");
        await page.keyboard.up("ArrowRight");
        const after = await recovery(page);
        expect(after.document).toEqual(before.document);
        expect(after.workspace.float).toEqual(before.workspace.float);
        expect(after.workspace.rotation).toBe(45);
        expect(after.workspace.activeTool).toBe("pencil");
        expect(await camera(page)).toEqual(view);
        expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(history);
    });
}

test("Undo and Redo preserve the current chart view", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.keyboard.press("r");
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Zoom in" }).click();
    const view = await camera(page);
    await page.keyboard.press("Control+z");
    expect((await recovery(page)).workspace.rotation).toBe(45);
    expect(await camera(page)).toEqual(view);
    await page.keyboard.press("Control+y");
    expect((await recovery(page)).workspace.rotation).toBe(45);
    expect(await camera(page)).toEqual(view);
});

for (const command of ["Delete", "pointer paint"]) {
    test(`${command} completes a held keyboard move before starting a separate edit`, async ({ page }) => {
        await bootApp(page);
        await selectForMove(page);
        await page.keyboard.down("ArrowRight");
        if (command === "Delete") await page.keyboard.press("Delete");
        else {
            await page.keyboard.press("p");
            await clickCell(page, 2, 1, { button: "right" });
        }
        await page.keyboard.press("Escape");
        await page.keyboard.up("ArrowRight");
        const source = await cellCoord(page, 1, 1);
        const destination = await cellCoord(page, 2, 1);
        expect(await pixelRGB(page, source.cx, source.cy)).toEqual([255, 255, 255]);
        expect(await pixelRGB(page, destination.cx, destination.cy)).toEqual([255, 255, 255]);
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+z");
        expect((await recovery(page)).workspace.float.x).toBe(2);
        expect((await recovery(page)).workspace.float.pixels).toBe("AQ==");
    });
}

test("successful keyboard Paste completes a held move and undoes to its final position", async ({ page }) => {
    await bootApp(page);
    await selectForMove(page);
    await page.keyboard.press("Control+c");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.press("Control+v");
    await page.keyboard.up("ArrowRight");
    await page.keyboard.press("Control+z");
    expect((await recovery(page)).workspace.float).toMatchObject({ x: 2, pixels: "AQ==" });
});

test("failed keyboard Paste leaves a held move cancellable without adding history", async ({ page }) => {
    await bootApp(page);
    await selectForMove(page);
    const before = await recovery(page);
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("Control");
    await page.keyboard.press("v");
    await page.keyboard.press("Escape");
    await page.keyboard.up("Control");
    await page.keyboard.up("ArrowRight");
    expect(await recovery(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(history);
});

test("empty and unusable Paste preserve tool and active selection and explain failure", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("Control+v");
    await expect(page.getByRole("button", { name: "Pencil", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#status-feedback")).toContainText(/clipboard.*empty/i);
    await page.keyboard.press("s");
    await clickCell(page, 8, 8);
    await page.keyboard.press("Control+c");
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#edit-width").fill("3");
    await page.locator("#edit-height").fill("3");
    await page.locator("#edit-height").press("Tab");
    await page.keyboard.press("Escape");
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    const before = await recovery(page);
    await page.keyboard.press("Control+v");
    expect(await recovery(page)).toEqual(before);
    await expect(page.locator("#status-feedback")).toContainText(/cannot.*pattern/i);
});

for (const event of ["lostpointercapture", "blur", "Escape", "pointercancel"]) {
    test(`${event} restores a previewed paint stroke and permits the next stroke`, async ({ page }) => {
        await bootApp(page);
        const cell = await cellCoord(page, 1, 1);
        const before = await recovery(page);
        await page.mouse.move(cell.cx, cell.cy);
        await page.mouse.down();
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([0, 0, 0]);
        if (event === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        else if (event === "Escape") await page.keyboard.press("Escape");
        else await page.locator("#canvas").dispatchEvent(event, { pointerId: 1, pointerType: "mouse", button: 0 });
        await page.mouse.up();
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([255, 255, 255]);
        expect(await recovery(page)).toEqual(before);
        await clickCell(page, 1, 1);
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([0, 0, 0]);
    });
}

for (const command of ["Delete", "Control+x", "Control+Shift+a", "Control+a", "Control+v"]) {
    test(`${command} settles a held pointer edit before authoring a separate command`, async ({ page }) => {
        await bootApp(page);
        await clickCell(page, 1, 1);
        await page.keyboard.press("s");
        await clickCell(page, 1, 1);
        await page.getByRole("button", { name: "Close inspector" }).click();
        if (command === "Control+v") {
            await page.keyboard.press("Control+c");
            await page.keyboard.press("m");
            await page.keyboard.press("ArrowRight");
        }
        await page.keyboard.press("p");
        await page.keyboard.press("2");
        const cell = await cellCoord(page, command === "Control+v" ? 2 : 1, 1);
        await page.mouse.move(cell.cx, cell.cy);
        await page.mouse.down();
        await page.keyboard.press(command);
        const after = await recovery(page);
        await page.locator("#canvas").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0 });
        await page.mouse.up();
        expect(await recovery(page)).toEqual(after);
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+y");
        expect(await recovery(page)).toEqual(after);
    });
}

test("failed Paste keeps a held pointer edit cancellable", async ({ page }) => {
    await bootApp(page);
    const before = await recovery(page);
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    const cell = await cellCoord(page, 1, 1);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down();
    await page.keyboard.press("Control+v");
    await page.keyboard.press("Escape");
    await page.mouse.up();
    expect(await recovery(page)).toEqual(before);
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(history);
});

for (const key of ["v", "h", "c", "d", "a"]) {
    test(`${key} mirror command settles a held stroke before its own history entry`, async ({ page }) => {
        await bootApp(page);
        const cell = await cellCoord(page, 1, 1);
        await page.mouse.move(cell.cx, cell.cy);
        await page.mouse.down();
        await page.keyboard.press(key);
        const authored = await recovery(page);
        await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        await page.mouse.up();
        expect(await recovery(page)).toEqual(authored);
        await page.keyboard.press("Control+z");
        await page.keyboard.press("Control+y");
        expect(await recovery(page)).toEqual(authored);
    });
}

test("an arrow Move after a chosen tool change settles the held pointer first", async ({ page }) => {
    await bootApp(page);
    await selectForMove(page);
    await page.keyboard.press("p");
    await page.keyboard.press("2");
    const cell = await cellCoord(page, 1, 1);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down();
    await page.keyboard.press("m");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.down("ArrowRight");
    await page.keyboard.up("ArrowRight");
    const after = await recovery(page);
    expect(after.workspace.float).toMatchObject({ x: 3, pixels: "Ag==" });
    await page.locator("#canvas").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0 });
    await page.mouse.up();
    expect(await recovery(page)).toEqual(after);
    await page.keyboard.press("Control+z");
    expect((await recovery(page)).workspace.float).toMatchObject({ x: 1, pixels: "Ag==" });
});

test("an accepted Stamp settles a held pointer before its own authored result", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Close inspector" }).click();
    await page.keyboard.press("v");
    await page.keyboard.press("p");
    const cell = await cellCoord(page, 1, 1);
    await page.mouse.move(cell.cx, cell.cy);
    await page.mouse.down();
    await page.keyboard.press("t");
    const mirrored = await cellCoord(page, 7, 1);
    expect(await pixelRGB(page, mirrored.cx, mirrored.cy)).toEqual([0, 0, 0]);
    const after = await recovery(page);
    await page.locator("#canvas").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0 });
    await page.mouse.up();
    expect(await recovery(page)).toEqual(after);
});

test("keyboard Move area uses the Rectangle source committed when pointer input settles", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("s");
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Close inspector" }).click();
    const first = await cellCoord(page, 1, 1);
    const second = await cellCoord(page, 2, 1);
    await page.mouse.move(first.cx, first.cy);
    await page.mouse.down();
    await page.mouse.move(second.cx, second.cy);
    await page.keyboard.press("m");
    await page.keyboard.down("Alt");
    await page.keyboard.down("ArrowRight");
    const right = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, right.cx, right.cy)).toEqual([255, 255, 255]);
    await page.keyboard.up("ArrowRight");
    await page.keyboard.up("Alt");
    await page.mouse.up();
    expect((await recovery(page)).workspace.float).toMatchObject({ x: 2, y: 1, w: 2, h: 1, pixels: "AgI=" });
});

for (const id of ["color-a", "color-b", "danger-color", "accent-color"]) {
    test(`${id} preview and commit is one undoable project colour edit`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Pattern", exact: true }).click();
        const before = (await recovery(page)).document;
        await page.locator(`#${id}`).evaluate((input: HTMLInputElement) => {
            input.value = "#123456";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.value = "#abcdef";
            input.dispatchEvent(new Event("input", { bubbles: true }));
            input.dispatchEvent(new Event("change", { bubbles: true }));
        });
        const after = (await recovery(page)).document;
        await expect(page.getByRole("button", { name: "Undo", exact: true })).toBeEnabled();
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect((await recovery(page)).document).toEqual(before);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        expect((await recovery(page)).document).toEqual(after);
    });
}

test("yarn swap and each yarn reset restore through Undo and Redo", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#color-a").fill("#123456");
    await page.locator("#color-b").fill("#abcdef");
    const before = (await recovery(page)).document;
    for (const name of ["Swap yarn colours", "Reset Yarn A to default", "Reset Yarn B to default"]) {
        await page.getByRole("button", { name, exact: true }).click();
        const after = (await recovery(page)).document;
        expect(after).not.toEqual(before);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect((await recovery(page)).document).toEqual(before);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        expect((await recovery(page)).document).toEqual(after);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
    }
});

test("project colour resets and contrast suggestions each undo in one step", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    await page.locator("#danger-color").fill("#123456");
    await page.locator("#accent-color").fill("#abcdef");
    const before = (await recovery(page)).document;
    for (const name of ["Reset danger colour", "Reset accent colour", "Find contrast"]) {
        await page.getByRole("button", { name, exact: true }).click();
        await page.getByRole("button", { name: "Undo", exact: true }).click();
        expect((await recovery(page)).document).toEqual(before);
        await page.getByRole("button", { name: "Redo", exact: true }).click();
        expect((await recovery(page)).document).not.toEqual(before);
        await page.getByRole("button", { name: "Undo", exact: true }).click();
    }
});

test("undoing legacy snapshots preserves current unknown project overrides", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 1, 1);
    await page.evaluate(() => {
        const history = JSON.parse(localStorage.getItem("mosaic-history")!);
        history.version = 5;
        for (const snapshot of history.snapshots) {
            delete snapshot.document.dangerColorOverride;
            delete snapshot.document.accentColorOverride;
        }
        localStorage.setItem("mosaic-history", JSON.stringify(history));
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        recovery.document.dangerColorOverride = "#123456";
        recovery.document.accentColorOverride = "#abcdef";
        localStorage.setItem("mosaic-recovery", JSON.stringify(recovery));
    });
    await page.reload();
    await page.waitForFunction(() => !!window.__test_matrix__);
    await page.keyboard.press("Control+z");
    expect((await recovery(page)).document).toMatchObject({ dangerColorOverride: "#123456", accentColorOverride: "#abcdef" });
});

for (const event of ["pointercancel", "lostpointercapture", "blur", "Escape"]) {
    test(`${event} during Move area restores a partially off-pattern selection`, async ({ page }) => {
        await bootApp(page);
        await page.keyboard.press("s");
        const first = await cellCoord(page, 0, 1);
        const second = await cellCoord(page, 1, 1);
        await page.mouse.move(first.cx, first.cy);
        await page.mouse.down();
        await page.mouse.move(second.cx, second.cy);
        await page.mouse.up();
        await page.getByRole("button", { name: "Move", exact: true }).click();
        await page.getByRole("button", { name: "Close inspector" }).click();
        await page.locator("#canvas").focus();
        await page.keyboard.press("ArrowLeft");
        const before = await recovery(page);
        const origin = await cellCoord(page, 0, 1);
        await page.keyboard.down("Alt");
        await page.mouse.move(origin.cx, origin.cy);
        await page.mouse.down();
        if (event === "blur") await page.evaluate(() => window.dispatchEvent(new Event("blur")));
        else if (event === "Escape") await page.keyboard.press("Escape");
        else await page.locator("#canvas").dispatchEvent(event, { pointerId: 1, pointerType: "mouse", button: 0 });
        await page.mouse.up();
        await page.keyboard.up("Alt");
        expect(await recovery(page)).toEqual(before);
    });
}

for (const route of ["keyboard", "pointer"]) {
    test(`unavailable Move area preserves an off-pattern selection through ${route}`, async ({ page }) => {
        await bootApp(page);
        await selectForMove(page);
        await page.keyboard.press("Shift+ArrowLeft");
        const before = await recovery(page);
        const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
        await page.keyboard.down("Alt");
        if (route === "keyboard") await page.keyboard.press("ArrowRight");
        else {
            const cell = await cellCoord(page, 0, 1);
            await page.mouse.move(cell.cx, cell.cy);
            await page.mouse.down();
            await page.locator("#canvas").dispatchEvent("pointercancel", { pointerId: 1, pointerType: "mouse", button: 0 });
            await page.mouse.up();
        }
        await page.keyboard.up("Alt");
        expect(await recovery(page)).toEqual(before);
        expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(history);
        await expect(page.locator("#status-feedback")).toContainText(/selection.*outside.*pattern/i);
    });
}

test("opening a different project resets orientation and fits the available chart workspace", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bootApp(page);
    const initial = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.getByRole("button", { name: "Zoom in" }).click();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "different.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
        version: 1, state: { mode: "row", canvasWidth: 9, canvasHeight: 9 },
        pixels: Array.from({ length: 81 }, (_, i) => Math.floor(i / 9) % 2 === 0 ? 1 : 2),
        colorA: "#123456", colorB: "#ffffff",
    })) });
    await expect.poll(async () => (await recovery(page)).document.colorA).toBe("#123456");
    expect((await recovery(page)).workspace.rotation).toBe(0);
    expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(initial);
});

for (const outcome of ["invalid", "cancelled", "identical"]) {
    test(`${outcome} Open preserves Crochet and its current chart view`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await bootApp(page);
        await clickCell(page, 1, 1);
        const project = (await recovery(page)).document;
        await page.locator("#btn-export").click();
        await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
        await page.getByRole("button", { name: "Forward one row" }).click();
        await page.getByRole("button", { name: "Rotate view right" }).click();
        await page.waitForTimeout(300);
        await page.getByRole("button", { name: "Zoom in" }).click();
        const before = await recovery(page);
        const matrix = await camera(page);
        if (outcome === "cancelled") {
            await page.evaluate(() => {
                const click = HTMLInputElement.prototype.click;
                HTMLInputElement.prototype.click = function () {
                    if (this.type === "file") this.dispatchEvent(new Event("cancel"));
                    else click.call(this);
                };
            });
            await page.getByRole("button", { name: "Open", exact: true }).click();
        } else {
            const chooser = page.waitForEvent("filechooser");
            await page.getByRole("button", { name: "Open", exact: true }).click();
            await (await chooser).setFiles({ name: "pattern.mcw", mimeType: "application/json",
                buffer: Buffer.from(outcome === "invalid" ? "invalid" : JSON.stringify({ version: 3, ...project })) });
            if (outcome === "invalid") await expect(page.locator("#document-error")).toBeVisible();
        }
        await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "true");
        expect(await recovery(page)).toEqual(before);
        expect(await camera(page)).toEqual(matrix);
    });
}

test("opening a different project from Crochet returns to Design and renders the new chart", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "different.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
        version: 1, state: { mode: "row", canvasWidth: 9, canvasHeight: 9 },
        pixels: Array.from({ length: 81 }, (_, i) => Math.floor(i / 9) % 2 === 0 ? 1 : 2),
        colorA: "#123456", colorB: "#ffffff",
    })) });
    await expect.poll(async () => (await recovery(page)).document.colorA).toBe("#123456");
    await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
    const cell = await cellCoord(page, 1, 0);
    expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([18, 52, 86]);
});

for (const action of ["New", "Example"]) {
    test(`${action} resets orientation and fits its pattern immediately`, async ({ page }) => {
        await page.emulateMedia({ reducedMotion: "reduce" });
        await bootApp(page);
        await page.locator("#btn-export").click();
        await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
        await page.getByRole("button", { name: "Rotate view right" }).click();
        await page.getByRole("button", { name: "Zoom in" }).click();
        await page.getByRole("button", { name: "Settings" }).click();
        await page.locator("#settings-about").click();
        await page.locator(action === "New" ? "#about-new" : "#about-example").click();
        await expect(page.locator("#btn-export")).toHaveAttribute("aria-pressed", "false");
        expect((await recovery(page)).workspace.rotation).toBe(0);
        expect(await page.evaluate(() => window.__test_matrix__!.b)).toBe(0);
        const fitted = await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()));
        await page.getByRole("button", { name: "Fit view" }).click();
        expect(await page.evaluate(() => Array.from(window.__test_matrix__!.toFloat64Array()))).toEqual(fitted);
    });
}

test("invalid and cancelled Open preserve the chart view", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Rotate view right" }).click();
    await page.waitForTimeout(300);
    await page.getByRole("button", { name: "Zoom in" }).click();
    const before = await recovery(page);
    const matrix = await camera(page);
    const chooser = page.waitForEvent("filechooser");
    await page.getByRole("button", { name: "Open", exact: true }).click();
    await (await chooser).setFiles({ name: "invalid.mcw", mimeType: "application/json", buffer: Buffer.from("invalid") });
    await expect(page.locator("#document-error")).toBeVisible();
    expect(await recovery(page)).toEqual(before);
    expect(await camera(page)).toEqual(matrix);
    await page.evaluate(() => {
        const click = HTMLInputElement.prototype.click;
        HTMLInputElement.prototype.click = function () {
            if (this.type === "file") this.dispatchEvent(new Event("cancel"));
            else click.call(this);
        };
    });
    await page.getByRole("button", { name: "Open", exact: true }).click();
    expect(await recovery(page)).toEqual(before);
    expect(await camera(page)).toEqual(matrix);
});
