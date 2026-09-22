// Symmetry toggles + Pattern inspector resize.
import { test, expect } from "@playwright/test";
import { bootApp, clickCell, dragCells, cellCoord, pixelRGB } from "./_helpers";

test("vertical symmetry mirrors paint horizontally", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");   // toggle Vertical symmetry
    await page.keyboard.press("p");
    // Paint cell (0, 1) — should mirror to (8, 1) on a 9-wide canvas.
    await clickCell(page, 0, 1);
    const right = await cellCoord(page, 8, 1);
    const [r, g, b] = await pixelRGB(page, right.cx, right.cy);
    // Primary = A = #000 → all three near 0.
    expect(r).toBeLessThan(50);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
});

test("dragging the V symmetry guide moves the mirror axis", async ({ page }) => {
    // V axis sits at canonical centre (x=4 on 9-wide). Drag its guide to
    // x=2; painting (0, 1) should now mirror to (4, 1) instead of (8, 1).
    await bootApp(page);
    await page.keyboard.press("v");        // toggle V on
    await page.keyboard.press("m");        // Move tool — axis-drag only fires here
    // Guide line for canonical V is at render x = 4.5. Click at (4.5, 4) cell coords.
    const start = await cellCoord(page, 4, 4);
    const end   = await cellCoord(page, 2, 4);
    // Offset by half a cell width so we land on the guide (render x=4.5), not the
    // cell-corner. cellCoord gives the centre, so it's already at render x=4.5.
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 8 });
    await page.mouse.up();
    // Switch to pencil and paint (0, 1) — should mirror to (4, 1) per the new V at x=2.
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    const mirrored = await cellCoord(page, 4, 1);
    const [r, g, b] = await pixelRGB(page, mirrored.cx, mirrored.cy);
    expect(r).toBeLessThan(50);
    expect(g).toBeLessThan(50);
    expect(b).toBeLessThan(50);
});

test("Mirror inspector lets Pencil drag a guide without painting", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await page.getByRole("button", { name: "Add vertical" }).click();
    const start = await cellCoord(page, 4, 4);
    const end = await cellCoord(page, 2, 4);
    const before = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels,
    );

    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 8 });
    await page.mouse.up();

    await expect(page.getByRole("button", { name: "Pencil" })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Disable vertical axis at x=2" })).toBeVisible();
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document.pixels,
    )).toEqual(before);
});

test("exact symmetry position entry is one undoable edit", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await page.getByRole("button", { name: "Add vertical" }).click();
    const position = page.getByRole("spinbutton", { name: "Vertical axis x position" });
    await expect(position).toHaveValue("4");

    await position.fill("2.5");
    await position.press("Tab");
    await expect(page.getByRole("button", { name: "Disable vertical axis at x=2.5" })).toBeVisible();
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.getByRole("button", { name: "Disable vertical axis at x=4" })).toBeVisible();
});

test("Symmetry popover: add V, toggle off, delete", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    // Add a V axis.
    await page.locator("#add-sym-v").click();
    const row = page.locator(".sym-list-row").first();
    await expect(row).toBeVisible();
    await expect(row).not.toHaveClass(/is-inactive/);
    // Toggle it off — visual class flips.
    await row.getByRole("button", { name: "Disable vertical axis at x=4" }).click();
    await expect(page.locator(".sym-list-row").first()).toHaveClass(/is-inactive/);
    // Delete — row disappears.
    await page.getByRole("button", { name: "Delete vertical axis at x=4" }).click();
    await expect(page.locator(".sym-list-row")).toHaveCount(0);
});

test("transform toolbar shows whether configured transforms apply while drawing", async ({ page }) => {
    await bootApp(page);
    const transforms = page.locator("#btn-sym-toggle");
    await expect(transforms).toHaveAttribute("aria-label", "Global Mirror: no axes configured");

    await transforms.click();
    await page.locator("#add-sym-v").click();
    await expect(transforms).toHaveAttribute("aria-label", "Global Mirror: applying while drawing");

    await page.locator("label:has(#live-transforms)").click();
    await expect(transforms).toHaveAttribute("aria-label", "Global Mirror: drawing application paused");
});

test("Apply Global Mirror applies symmetry and keeps the source selected", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await clickCell(page, 0, 1);

    await page.locator("#btn-sym-toggle").click();
    const replicate = page.locator("#replicate-selection");
    await expect(replicate).toBeDisabled();
    await page.locator("#add-sym-v").click();
    await expect(replicate).toBeEnabled();
    await replicate.click();

    const mirrored = await cellCoord(page, 8, 1);
    expect(await pixelRGB(page, mirrored.cx, mirrored.cy)).toEqual([0, 0, 0]);

    await page.getByRole("button", { name: "Move", exact: true }).click();
    await page.getByRole("img", { name: "Editable pattern chart" }).focus();
    await page.keyboard.press("ArrowRight");
    const oldSource = await cellCoord(page, 0, 1);
    const movedSource = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, oldSource.cx, oldSource.cy)).not.toEqual([0, 0, 0]);
    expect(await pixelRGB(page, movedSource.cx, movedSource.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, mirrored.cx, mirrored.cy)).toEqual([0, 0, 0]);
});

test("T reports stamp conflicts inline and recipe changes clear the error", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    await page.keyboard.press("s");
    await dragCells(page, 0, 1, 8, 1);
    await page.keyboard.press("v");

    let dialogSeen = false;
    page.on("dialog", async dialog => {
        dialogSeen = true;
        await dialog.dismiss();
    });
    await page.keyboard.press("t");

    await expect(page.locator("#sym-popover")).toBeVisible();
    const error = page.locator("#transform-error");
    await expect(error).toContainText(/different colours.*transformed destination/i);
    await expect(error).toBeVisible();
    expect(dialogSeen).toBe(false);

    await page.getByRole("button", { name: "Disable vertical axis at x=4" }).click();
    await expect(error).toBeHidden();
});

test("saved repeat extends the active selection and applies its instances", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);
    if (!await page.locator("#selection-popover").isVisible()) {
        await page.getByRole("button", { name: /Selection actions/ }).click();
    }
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Enter");
    await page.locator("#recipe-apply").click();
    const copy = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([0, 0, 0]);
    const source = await cellCoord(page, 2, 1);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await page.keyboard.press("p");
    await clickCell(page, 3, 1);
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([255, 255, 255]);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([255, 255, 255]);
    await page.locator("label:has(#recipe-enabled)").click();
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 2, 1);
    expect(await pixelRGB(page, source.cx, source.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, copy.cx, copy.cy)).toEqual([255, 255, 255]);
    await expect(page.locator("#recipe-list")).toContainText("Repeat 1");
});

test("saved grid repeats apply independent directions, angled vectors, and alternating gaps", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pencil" }).click();
    await clickCell(page, 3, 3);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 3, 3);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-left").fill("1");
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-up").fill("1");
    await page.locator("#recipe-down").fill("1");
    await page.locator("#recipe-column-offset").fill("1");
    await page.locator("#recipe-row-offset").fill("2");
    await page.locator("label:has(#recipe-column-mirrored)").click();
    await page.locator("#recipe-gap-x-alternate").fill("1");
    await page.locator("#recipe-gap-x-alternate").dispatchEvent("change");
    await page.locator("#recipe-apply").click();

    for (const [x, y] of [[0, 1], [8, 6]] as const) {
        const cell = await cellCoord(page, x, y);
        expect(await pixelRGB(page, cell.cx, cell.cy), `${x},${y}`).toEqual([0, 0, 0]);
    }
});

test("rotation repeat applies selected quarters and live drawing from an instance", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    for (const [x, y] of [[4, 4], [3, 3], [4, 2]] as const) await clickCell(page, x, y);
    await page.getByRole("button", { name: "Yarn A", exact: true }).click();
    await clickCell(page, 5, 3);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 5, 3);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-right").dispatchEvent("change");
    await page.locator("label:has(#recipe-mode-rotation)").click();
    await page.locator("#recipe-centre-x").fill("4");
    await page.locator("#recipe-centre-y").fill("3");
    for (const turn of [90, 180, 270]) await page.locator(`label:has(#recipe-turn-${turn})`).click();
    await page.locator("#recipe-turn-270").dispatchEvent("change");
    await page.locator("#recipe-apply").click();

    for (const [x, y] of [[5, 3], [4, 4], [3, 3], [4, 2]] as const) {
        const cell = await cellCoord(page, x, y);
        expect(await pixelRGB(page, cell.cx, cell.cy), `${x},${y}`).toEqual([0, 0, 0]);
    }
    const retainedGridTarget = await cellCoord(page, 6, 3);
    expect(await pixelRGB(page, retainedGridTarget.cx, retainedGridTarget.cy)).toEqual([255, 255, 255]);

    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await page.getByRole("button", { name: "Pencil" }).click();
    await clickCell(page, 4, 4);
    for (const [x, y] of [[5, 3], [4, 4], [3, 3], [4, 2]] as const) {
        const cell = await cellCoord(page, x, y);
        expect(await pixelRGB(page, cell.cx, cell.cy), `${x},${y}`).toEqual([255, 255, 255]);
    }
});

test("saved-repeat instances drive Invert and Eraser across the extended selection", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").dispatchEvent("change");
    await page.getByRole("button", { name: "Invert colours" }).click();
    await clickCell(page, 3, 1);

    for (const x of [2, 3]) {
        const cell = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([0, 0, 0]);
    }

    await page.getByRole("button", { name: "Eraser" }).click();
    await clickCell(page, 3, 1);
    for (const x of [2, 3]) {
        const cell = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, cell.cx, cell.cy)).toEqual([255, 255, 255]);
    }
});

test("saved repeat controls reject overlap and claim-limit configurations before commit", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.getByRole("button", { name: /^Add/ }).click();
    await clickCell(page, 3, 2);
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").dispatchEvent("change");
    await page.locator("#recipe-down").fill("1");
    await page.locator("#recipe-down").dispatchEvent("change");
    await expect(page.locator("#recipe-error")).toContainText(/overlap/i);

    await page.locator("#recipe-right").fill("4096");
    await page.locator("#recipe-right").dispatchEvent("change");
    await expect(page.locator("#recipe-error")).toContainText("4,096");
});

test("rejected saved-repeat values, modes, and turns return controls to stored state", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.getByRole("button", { name: /^Add/ }).click();
    await clickCell(page, 3, 1);
    await page.locator("#recipe-create").click();

    const left = page.locator("#recipe-left");
    await left.fill("-1");
    await left.dispatchEvent("change");
    await expect(page.locator("#recipe-error")).toContainText(/counts/i);
    await expect(left).toHaveValue("0");

    await page.locator("#recipe-mode-rotation").evaluate(input => { input.value = "unsupported"; });
    await page.locator("label:has(#recipe-mode-rotation)").click();
    await expect(page.locator("#recipe-error")).toContainText(/mode/i);
    await expect(page.locator("#recipe-mode-grid")).toBeChecked();
    await expect(page.locator("#recipe-mode-rotation")).not.toBeChecked();

    await page.locator("#recipe-mode-rotation").evaluate(input => { input.value = "rotation"; });
    await page.locator("label:has(#recipe-mode-rotation)").click();
    await page.locator("label:has(#recipe-turn-180)").click();
    await expect(page.locator("#recipe-error")).toContainText(/overlap/i);
    await expect(page.locator("#recipe-turn-180")).not.toBeChecked();

    const stored = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0],
    );
    expect(stored).toMatchObject({ left: 0, mode: "rotation", rotationTurns: [] });
});

test("live paint keeps a packed repeat that lands in a sparse source hole", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pencil" }).click();
    await clickCell(page, 2, 1);
    await clickCell(page, 3, 1);
    await clickCell(page, 4, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.getByRole("button", { name: /^Add/ }).click();
    await clickCell(page, 4, 1);
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").dispatchEvent("change");
    await page.getByRole("button", { name: "Yarn B", exact: true }).click();
    await page.getByRole("button", { name: "Pencil" }).click();

    await clickCell(page, 2, 1);

    const packedCopy = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, packedCopy.cx, packedCopy.cy)).toEqual([255, 255, 255]);
});

for (const [origin, clickX] of [["source", 2], ["ghost", 3]] as const) {
    test(`Fill from a saved-repeat ${origin} stays inside the extended selection`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await clickCell(page, 2, 1);
        await page.getByRole("button", { name: /Selection actions/ }).click();
        await page.locator("#recipe-create").click();
        await page.locator("#recipe-right").fill("1");
        await page.locator("#recipe-right").dispatchEvent("change");
        await page.getByRole("button", { name: /Global Mirror/ }).click();
        await page.getByRole("button", { name: "Add vertical" }).click();
        await page.getByRole("button", { name: "Yarn A", exact: true }).click();
        await page.getByRole("button", { name: "Fill" }).click();

        await clickCell(page, clickX, 1);

        for (const x of [2, 3]) {
            const selected = await cellCoord(page, x, 1);
            expect(await pixelRGB(page, selected.cx, selected.cy)).toEqual([0, 0, 0]);
        }
        for (const x of [1, 4, 5, 6]) {
            const outside = await cellCoord(page, x, 1);
            expect(await pixelRGB(page, outside.cx, outside.cy), `cell ${x},1`).toEqual([255, 255, 255]);
        }
    });
}

for (const [origin, clickX] of [["source", 2], ["ghost", 3]] as const) {
    test(`Overlay from a saved-repeat ${origin} keeps Global Mirror inside the extended selection`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await clickCell(page, 2, 1);
        await page.getByRole("button", { name: /Selection actions/ }).click();
        await page.locator("#recipe-create").click();
        await page.locator("#recipe-right").fill("1");
        await page.locator("#recipe-right").dispatchEvent("change");
        await page.getByRole("button", { name: /Global Mirror/ }).click();
        await page.getByRole("button", { name: "Add vertical" }).click();
        await page.getByRole("button", { name: "Place overlay" }).click();

        const supportCells = await Promise.all([2, 3, 5, 6].map(x => cellCoord(page, x, 2)));
        const before = await Promise.all(supportCells.map(cell => pixelRGB(page, cell.cx, cell.cy)));
        await clickCell(page, clickX, 1);

        for (const [index, x] of [2, 3].entries()) {
            const cell = supportCells[index];
            expect(await pixelRGB(page, cell.cx, cell.cy), `selected support ${x},2`).not.toEqual(before[index]);
        }
        for (const [index, x] of [5, 6].entries()) {
            const cellIndex = index + 2;
            const cell = supportCells[cellIndex];
            expect(await pixelRGB(page, cell.cx, cell.cy), `outside support ${x},2`).toEqual(before[cellIndex]);
        }
    });
}

test("saved repeat source follows moves and pointer cancel restores it", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 2, 1);
    await page.keyboard.press("s");
    await clickCell(page, 2, 1);
    if (!await page.locator("#selection-popover").isVisible()) {
        await page.getByRole("button", { name: /Selection actions/ }).click();
    }
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").press("Enter");
    await page.getByRole("button", { name: "Move", exact: true }).click();
    await dragCells(page, 2, 1, 3, 1);
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0].rotationCentreX,
    )).toBe(3);
    if (!await page.locator("#selection-popover").isVisible()) {
        await page.getByRole("button", { name: /Selection actions/ }).click();
    }
    await page.locator("#recipe-apply").click();
    const movedCopy = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, movedCopy.cx, movedCopy.cy)).toEqual([0, 0, 0]);
    const origin = await cellCoord(page, 3, 1);
    await page.mouse.move(origin.cx, origin.cy);
    await page.mouse.down();
    await page.mouse.move(movedCopy.cx, movedCopy.cy);
    await page.getByRole("img", { name: "Editable pattern chart" }).dispatchEvent("pointercancel", {
        pointerId: 1, pointerType: "mouse", button: 0, clientX: movedCopy.cx, clientY: movedCopy.cy,
    });
    await page.mouse.up();
    if (!await page.locator("#selection-popover").isVisible()) {
        await page.getByRole("button", { name: /Selection actions/ }).click();
    }
    await page.locator("#recipe-apply").click();
    expect(await pixelRGB(page, movedCopy.cx, movedCopy.cy)).toEqual([0, 0, 0]);
});

test("wand pointer cancel restores the saved repeat source transaction", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pencil" }).click();
    await clickCell(page, 1, 1);
    await clickCell(page, 3, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").dispatchEvent("change");
    await page.getByRole("button", { name: "Magic wand" }).click();
    const replacement = await cellCoord(page, 3, 1);
    await page.mouse.move(replacement.cx, replacement.cy);
    await page.mouse.down();
    await page.getByRole("img", { name: "Editable pattern chart" }).dispatchEvent("pointercancel", {
        pointerId: 1, pointerType: "mouse", button: 0,
        clientX: replacement.cx, clientY: replacement.cy,
    });
    await page.mouse.up();
    if (!await page.locator("#selection-popover").isVisible()) {
        await page.getByRole("button", { name: /Selection actions/ }).click();
    }

    await page.locator("#recipe-apply").click();

    const originalTarget = await cellCoord(page, 2, 1);
    const canceledTarget = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, originalTarget.cx, originalTarget.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, canceledTarget.cx, canceledTarget.cy)).toEqual([255, 255, 255]);
});

test("saved repeat source follows an explicit duplicate move", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pencil" }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").dispatchEvent("change");
    const duplicate = page.getByRole("button", { name: /Duplicate/ });
    await duplicate.click();
    await expect(duplicate).toHaveAttribute("aria-pressed", "true");

    await dragCells(page, 1, 1, 3, 1);
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0].rotationCentreX,
    )).toBe(3);
    await page.locator("#recipe-apply").click();

    const original = await cellCoord(page, 1, 1);
    const staleTarget = await cellCoord(page, 2, 1);
    const movedSource = await cellCoord(page, 3, 1);
    const movedTarget = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, original.cx, original.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, staleTarget.cx, staleTarget.cy)).not.toEqual([0, 0, 0]);
    expect(await pixelRGB(page, movedSource.cx, movedSource.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, movedTarget.cx, movedTarget.cy)).toEqual([0, 0, 0]);
});

test("saved repeat source follows an explicit move-area move", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pencil" }).click();
    await clickCell(page, 1, 1);
    await clickCell(page, 3, 1);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.locator("#recipe-right").fill("1");
    await page.locator("#recipe-right").dispatchEvent("change");
    const moveArea = page.getByRole("button", { name: /Move area/ });
    await moveArea.click();
    await expect(moveArea).toHaveAttribute("aria-pressed", "true");

    await dragCells(page, 1, 1, 3, 1);
    expect(await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0].rotationCentreX,
    )).toBe(3);
    await page.locator("#recipe-apply").click();

    const original = await cellCoord(page, 1, 1);
    const staleTarget = await cellCoord(page, 2, 1);
    const movedSource = await cellCoord(page, 3, 1);
    const movedTarget = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, original.cx, original.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, staleTarget.cx, staleTarget.cy)).not.toEqual([0, 0, 0]);
    expect(await pixelRGB(page, movedSource.cx, movedSource.cy)).toEqual([0, 0, 0]);
    expect(await pixelRGB(page, movedTarget.cx, movedTarget.cy)).toEqual([0, 0, 0]);
});

test("Pattern resize deactivates a saved repeat when it removes the source selection", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await expect(page.getByRole("button", { name: "Repeat 1", exact: true })).toHaveAttribute("aria-pressed", "true");

    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").press("Tab");
    await page.getByRole("button", { name: /Selection actions/ }).click();

    await expect(page.getByRole("button", { name: "Repeat 1", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#recipe-controls")).toBeHidden();
});

for (const action of ["Cut", "Deselect"] as const) {
    test(`${action} immediately clears the active saved-repeat projection`, async ({ page }) => {
        await bootApp(page);
        await page.getByRole("button", { name: "Select", exact: true }).click();
        await clickCell(page, 2, 1);
        await page.getByRole("button", { name: /Selection actions/ }).click();
        await page.locator("#recipe-create").click();
        const recipe = page.getByRole("button", { name: "Repeat 1", exact: true });
        await expect(recipe).toHaveAttribute("aria-pressed", "true");
        await expect(page.locator("#recipe-controls")).toBeVisible();

        await page.getByRole("button", { name: action, exact: true }).click();

        await expect(recipe).toHaveAttribute("aria-pressed", "false");
        await expect(page.locator("#recipe-controls")).toBeHidden();
    });
}

test("move-area into a round hole deactivates the saved repeat when nothing can be lifted", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator('label:has(input[name="edit-mode"][value="round"])').click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 0, 6);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.getByRole("button", { name: /Move area/ }).click();

    await dragCells(page, 0, 6, 6, 6);

    const recovery = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!));
    expect(recovery.workspace.float).toBeNull();
    expect(recovery.workspace.activeRecipeId).toBeNull();
});

test("dragging an axis far off the canvas deletes it", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");        // adds V at canonical centre
    await page.keyboard.press("m");        // Move tool
    // V guide is at render x=4.5 on a 9-wide canvas; click and drag far left.
    const start = await cellCoord(page, 4, 4);
    const farOff = await cellCoord(page, -10, 4);
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(farOff.cx, farOff.cy, { steps: 8 });
    await page.mouse.up();
    // Open popover — list should be empty.
    await page.locator("#btn-sym-toggle").click();
    await expect(page.locator(".sym-list-row")).toHaveCount(0);
});

test("Pattern inspector changes the canvas dimensions", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    const widthInput  = page.locator("#edit-width");
    const heightInput = page.locator("#edit-height");
    await widthInput.fill("5");
    await widthInput.dispatchEvent("input");
    await heightInput.fill("5");
    await heightInput.dispatchEvent("input");
    await heightInput.press("Tab");
    await page.keyboard.press("Escape");
    // The matrix hook updates each render; cell (4, 4) of a 5×5 canvas is
    // now valid where (4, 4) of 9×9 was already. We just smoke that the
    // app didn't blow up.
    await expect(page.locator("#canvas")).toBeVisible();
});

test("Pattern resize removes only global mirrors that become unusable", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");
    await page.keyboard.press("h");
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").press("Tab");
    await page.locator("#btn-sym-toggle").click();

    await expect(page.getByRole("button", { name: "Disable vertical axis at x=4" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Disable horizontal axis at y=4" })).toBeVisible();
});

test("Pattern preview retains global mirrors valid in the final geometry", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("9");
    await page.locator("#edit-width").press("Tab");
    await page.locator("#btn-sym-toggle").click();
    await expect(page.getByRole("button", { name: "Disable vertical axis at x=4" })).toBeVisible();
});

test("invalid Pattern preview restores the global mirror baseline", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("2000000");
    await expect(page.locator("#edit-error")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.locator("#btn-sym-toggle").click();
    await expect(page.getByRole("button", { name: "Disable vertical axis at x=4" })).toBeVisible();
});

test("invalid Pattern preview restores the active saved-repeat source", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: /Selection actions/ }).click();
    await page.locator("#recipe-create").click();
    await page.getByRole("button", { name: "Pattern" }).click();
    await page.locator("#edit-width").fill("5");
    await page.locator("#edit-width").fill("2000000");
    await expect(page.locator("#edit-error")).toBeVisible();
    await page.keyboard.press("Escape");
    await page.getByRole("button", { name: /Selection actions/ }).click();

    await expect(page.getByRole("button", { name: "Repeat 1", exact: true }))
        .toHaveAttribute("aria-pressed", "true");
    await expect(page.locator("#recipe-controls")).toBeVisible();
});

test("Pattern inspector rejects a canvas above the safety ceiling", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    await page.locator("#edit-width").fill("4097");
    await page.locator("#edit-height").fill("4097");

    await expect(page.locator("#edit-error")).toContainText("16,777,216");
    await expect(page.locator("#edit-error")).toBeVisible();
});

test("Load reports invalid pattern dimensions", async ({ page }) => {
    await bootApp(page);
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "invalid.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 2,
            state: { mode: "row", canvasWidth: 2.5, canvasHeight: 2 },
            pixels: "AA==",
            colorA: "#000000",
            colorB: "#ffffff",
        })),
    });

    const alert = page.getByRole("alert");
    await expect(alert).toContainText(/whole positive numbers/);

    const retryChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const retryChooser = await retryChooserPromise;
    await retryChooser.setFiles([]);
    await expect(alert).toBeHidden();
});

test("Load rejects a future file without replacing the active session", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    const before = await page.evaluate(() => localStorage.getItem("mosaic-recovery"));

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "future.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ version: 4 })),
    });

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("This pattern uses unsupported .mcw version 4.");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBe(before);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole("button", { name: "Dismiss document error" }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole("button", { name: "More" })).toBeFocused();
});

test("Open restores a global mirror without resetting Crochet progress", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await page.locator("#btn-export").click();
    const project = await page.evaluate(() => {
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return recovery.document;
    });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "global-mirror.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({
            version: 3,
            ...project,
            axes: [{ id: "saved-v", kind: "V", active: true, x: 2 }],
        })),
    });

    await expect(page.getByRole("button", { name: /Global Mirror/ })).toBeVisible();
    await page.getByRole("button", { name: /Global Mirror/ }).click();
    await expect(page.locator("#sym-popover")).toHaveAttribute("aria-label", "Global Mirror");
    await expect(page.getByText("Global mirrors", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Disable vertical axis at x=2" })).toBeVisible();
    await expect(page.locator("#btn-export")).toContainText("Continue Crocheting");

    await page.keyboard.press("p");
    await clickCell(page, 0, 1);
    const mirrored = await cellCoord(page, 4, 1);
    expect(await pixelRGB(page, mirrored.cx, mirrored.cy)).toEqual([0, 0, 0]);

    const legacyProject = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).document,
    );
    const legacyChooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const legacyChooser = await legacyChooserPromise;
    await legacyChooser.setFiles({
        name: "legacy-v2.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ version: 2, ...legacyProject })),
    });
    await expect(page.locator(".sym-list-row")).toHaveCount(0);
    await expect(page.locator("#btn-export")).toContainText("Continue Crocheting");
});

test("Open leaves an identical global-mirror project view unchanged", async ({ page }) => {
    await bootApp(page);
    await page.keyboard.press("v");
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.axes.length,
    )).toBe(1);
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(300);
    const project = await page.evaluate(() => {
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return { ...recovery.document, axes: recovery.workspace.axes };
    });
    const before = await page.evaluate(() => {
        const matrix = window.__test_matrix__!;
        return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "same-project.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify({ version: 3, ...project })),
    });

    await expect.poll(() => page.evaluate(() => {
        const matrix = window.__test_matrix__!;
        return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
    })).toEqual(before);
});

test("identical Open preserves Crochet progress and an active float", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Copy instructions" })).toBeEnabled();
    await page.getByRole("button", { name: "Forward one row" }).click();
    await page.locator("#btn-export").click();
    await page.keyboard.press("s");
    await dragCells(page, 1, 1, 1, 1);
    await page.keyboard.press("m");
    await dragCells(page, 1, 1, 1, 2);
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.float?.y,
    )).toBe(2);
    await page.evaluate(() => {
        const target = window as unknown as {
            savedMcw?: string;
            showSaveFilePicker?: () => Promise<{
                createWritable: () => Promise<{
                    write: (source: string) => Promise<void>;
                    close: () => Promise<void>;
                }>;
            }>;
        };
        target.showSaveFilePicker = async () => ({
            createWritable: async () => ({
                write: async source => { target.savedMcw = source; },
                close: async () => {},
            }),
        });
    });
    await page.locator("#btn-save").click();
    await expect.poll(() => page.evaluate(() =>
        (window as unknown as { savedMcw?: string }).savedMcw ?? null,
    )).not.toBeNull();
    await page.getByRole("button", { name: "Zoom in" }).click();
    await page.waitForTimeout(300);
    const before = await page.evaluate(() => {
        const recovery = localStorage.getItem("mosaic-recovery")!;
        const matrix = window.__test_matrix__!;
        return {
            savedMcw: (window as unknown as { savedMcw: string }).savedMcw,
            recovery,
            history: localStorage.getItem("mosaic-history"),
            matrix: [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f],
        };
    });

    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    const chooser = await chooserPromise;
    await chooser.setFiles({
        name: "same-with-float.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(before.savedMcw),
    });

    await expect(page.locator("#btn-export")).toContainText("Continue Crocheting");
    await expect.poll(() => page.evaluate(() => ({
        recovery: localStorage.getItem("mosaic-recovery"),
        history: localStorage.getItem("mosaic-history"),
        matrix: (() => {
            const matrix = window.__test_matrix__!;
            return [matrix.a, matrix.b, matrix.c, matrix.d, matrix.e, matrix.f];
        })(),
    }))).toEqual({ recovery: before.recovery, history: before.history, matrix: before.matrix });
});
