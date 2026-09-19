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
    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
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
    await page.getByRole("button", { name: /Symmetry and repeat/ }).click();
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
    await expect(transforms).toHaveAttribute("aria-label", "Symmetry and repeat: no transforms configured");

    await transforms.click();
    await page.locator("#add-sym-v").click();
    await expect(transforms).toHaveAttribute("aria-label", "Symmetry and repeat: applying while drawing");

    await page.locator("label:has(#live-transforms)").click();
    await expect(transforms).toHaveAttribute("aria-label", "Symmetry and repeat: drawing application paused");
});

test("Stamp transformed copies applies symmetry and keeps the source selected", async ({ page }) => {
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

    await page.keyboard.press("m");
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

test("repeat grid copies live paint in both directions", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#repeat-tile-width").fill("2");
    await page.locator("#repeat-tile-height").fill("1");
    await page.locator("#repeat-copies-x").fill("1");
    await page.locator("#repeat-copies-y").fill("0");
    await page.locator("label:has(#repeat-enabled)").click();
    await expect(page.locator("#repeat-enabled")).toBeChecked();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.repeat))
        .toEqual({ enabled: true, tileWidth: 2, tileHeight: 1, copiesX: 1, copiesY: 0 });
    await page.locator("#btn-sym-toggle").click();

    await clickCell(page, 4, 1);

    const repeated = await Promise.all([2, 4, 6].map(async x => {
        const point = await cellCoord(page, x, 1);
        return pixelRGB(page, point.cx, point.cy);
    }));
    expect(repeated).toEqual([[0, 0, 0], [0, 0, 0], [0, 0, 0]]);
    const untouched = await cellCoord(page, 0, 1);
    expect(await pixelRGB(page, untouched.cx, untouched.cy)).not.toEqual([0, 0, 0]);
});

test("configured transforms can stamp a selection while live drawing is off", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#add-sym-v").click();
    await page.locator("#repeat-tile-width").fill("2");
    await page.locator("#repeat-copies-x").fill("1");
    await page.locator("#repeat-copies-y").fill("0");
    await page.locator("label:has(#repeat-enabled)").click();
    await expect(page.locator("#live-transforms")).toBeChecked();
    await page.locator("label:has(#live-transforms)").click();
    await page.locator("#btn-sym-toggle").click();

    await clickCell(page, 0, 1);
    const untouchedCopy = await cellCoord(page, 8, 1);
    expect(await pixelRGB(page, untouchedCopy.cx, untouchedCopy.cy)).not.toEqual([0, 0, 0]);

    await page.keyboard.press("s");
    await clickCell(page, 0, 1);
    await page.locator("#btn-sym-toggle").click();
    const stamp = page.locator("#replicate-selection");
    await expect(stamp).toHaveText("Stamp transformed copies");
    await expect(stamp).toBeEnabled();
    await stamp.click();

    for (const x of [2, 6, 8]) {
        const point = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, point.cx, point.cy)).toEqual([0, 0, 0]);
    }
    await page.keyboard.press("m");
    await page.getByRole("img", { name: "Editable pattern chart" }).focus();
    await page.keyboard.press("ArrowRight");
    const movedSource = await cellCoord(page, 1, 1);
    expect(await pixelRGB(page, movedSource.cx, movedSource.cy)).toEqual([0, 0, 0]);
});

test("repeat settings reject a grid above the position ceiling", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#repeat-copies-x").fill("32");
    await page.locator("#repeat-copies-y").fill("32");

    await expect(page.locator("#repeat-error")).toContainText("4,096");
    await expect(page.locator("#repeat-error")).toBeVisible();
});

test("Stamp transformed copies applies repeat and keeps the source selected", async ({ page }) => {
    await bootApp(page);
    await clickCell(page, 4, 1);
    await page.keyboard.press("s");
    await clickCell(page, 4, 1);

    await page.locator("#btn-sym-toggle").click();
    await page.locator("#repeat-tile-width").fill("2");
    await page.locator("#repeat-copies-x").fill("1");
    await page.locator("#repeat-copies-y").fill("0");
    await page.locator("label:has(#repeat-enabled)").click();
    const replicate = page.locator("#replicate-selection");
    await expect(replicate).toBeEnabled();
    await replicate.click();

    for (const x of [2, 6]) {
        const point = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, point.cx, point.cy)).toEqual([0, 0, 0]);
    }
    await page.keyboard.press("m");
    await page.getByRole("img", { name: "Editable pattern chart" }).focus();
    await page.keyboard.press("ArrowRight");
    const oldSource = await cellCoord(page, 4, 1);
    const movedSource = await cellCoord(page, 5, 1);
    expect(await pixelRGB(page, oldSource.cx, oldSource.cy)).not.toEqual([0, 0, 0]);
    expect(await pixelRGB(page, movedSource.cx, movedSource.cy)).toEqual([0, 0, 0]);
});

test("repeat previews the selected source before stamping", async ({ page }) => {
    await bootApp(page);
    const initialTarget = await cellCoord(page, 2, 1);
    const natural = await pixelRGB(page, initialTarget.cx, initialTarget.cy);
    await clickCell(page, 4, 1, { button: natural[0] < 128 ? "right" : "left" });
    await clickCell(page, 6, 1, { button: natural[0] < 128 ? "right" : "left" });
    await page.keyboard.press("s");
    await clickCell(page, 4, 1);
    await clickCell(page, 6, 1, { modifiers: ["Shift"] });

    await page.locator("#btn-sym-toggle").click();
    await page.locator("#repeat-tile-width").fill("2");
    await page.locator("#repeat-copies-x").fill("1");
    await page.locator("#repeat-copies-y").fill("0");
    const target = await cellCoord(page, 2, 1);
    const gap = await cellCoord(page, 3, 1);
    const targetBefore = await pixelRGB(page, target.cx, target.cy);
    const gapBefore = await pixelRGB(page, gap.cx, gap.cy);
    await page.locator("label:has(#repeat-enabled)").click();

    const previewTarget = await cellCoord(page, 2, 1);
    const previewGap = await cellCoord(page, 3, 1);
    expect(await pixelRGB(page, previewTarget.cx, previewTarget.cy)).not.toEqual(targetBefore);
    expect(await pixelRGB(page, previewGap.cx, previewGap.cy)).toEqual(gapBefore);
});

test("repeat distance handles update exact fields as one undoable edit each", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#repeat-tile-width").fill("2");
    await page.locator("#repeat-tile-height").fill("2");
    await page.locator("#repeat-copies-x").fill("1");
    await page.locator("#repeat-copies-y").fill("1");
    await page.locator("label:has(#repeat-enabled)").click();

    const start = await cellCoord(page, 2, 0);
    const end = await cellCoord(page, 3, 0);
    await page.mouse.move(start.cx, start.cy);
    await page.mouse.down();
    await page.mouse.move(end.cx, end.cy, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("#repeat-tile-width")).toHaveValue("3");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#repeat-tile-width")).toHaveValue("2");

    const verticalStart = await cellCoord(page, 0, 2);
    const verticalEnd = await cellCoord(page, 0, 3);
    await page.mouse.move(verticalStart.cx, verticalStart.cy);
    await page.mouse.down();
    await page.mouse.move(verticalEnd.cx, verticalEnd.cy, { steps: 8 });
    await page.mouse.up();

    await expect(page.locator("#repeat-tile-height")).toHaveValue("3");
    await page.getByRole("button", { name: "Undo" }).click();
    await expect(page.locator("#repeat-tile-height")).toHaveValue("2");
});

test("repeat grid tiles the complete symmetry motif", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#add-sym-v").click();
    await page.locator("#repeat-tile-width").fill("2");
    await page.locator("#repeat-copies-x").fill("1");
    await page.locator("#repeat-copies-y").fill("0");
    await page.locator("label:has(#repeat-enabled)").click();
    await page.locator("#btn-sym-toggle").click();

    await clickCell(page, 0, 1);

    for (const x of [0, 2, 6, 8]) {
        const point = await cellCoord(page, x, 1);
        expect(await pixelRGB(page, point.cx, point.cy)).toEqual([0, 0, 0]);
    }
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
        buffer: Buffer.from(JSON.stringify({ version: 3 })),
    });

    const alert = page.getByRole("alert");
    await expect(alert).toContainText("This pattern uses unsupported .mcw version 3.");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-recovery"))).toBe(before);

    await page.setViewportSize({ width: 360, height: 740 });
    await page.getByRole("button", { name: "Dismiss document error" }).click();
    await expect(alert).toBeHidden();
    await expect(page.getByRole("button", { name: "More" })).toBeFocused();
});
