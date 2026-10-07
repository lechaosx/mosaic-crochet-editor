import { test, expect } from "@playwright/test";
import { addGlobalMirror, bootApp, clickCell } from "./_helpers";

test("workspace transitions preserve canvas geometry near the compact toolbar threshold", async ({ page }) => {
    await page.setViewportSize({ width: 860, height: 900 });
    await bootApp(page);
    const bounds = await page.locator("#canvas").boundingBox();
    await page.locator("#btn-export").click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await page.locator("#canvas").boundingBox()).toEqual(bounds);
    await expect(page.locator("#export-copy")).toBeEnabled();
    await page.locator("#instructions-units button").nth(1).click();
    await page.locator("#btn-export").click();
    await expect(page.getByRole("button", { name: "Continue Crocheting", exact: true })).toBeVisible();
    expect(await page.locator("#canvas").boundingBox()).toEqual(bounds);
});

test("increasing text size recomposes document actions without overlapping Crochet", async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 960 });
    await bootApp(page);
    await page.addStyleTag({ content: "html { font-size: 200%; }" });
    await expect.poll(() => page.evaluate(() => {
        const crochet = document.querySelector("#btn-export")!.getBoundingClientRect();
        return Array.from(document.querySelectorAll<HTMLButtonElement>(".g-file button, .g-hlrot button"))
            .filter(button => button.getClientRects().length > 0)
            .every(button => {
                const box = button.getBoundingClientRect();
                return box.right <= crochet.left || box.left >= crochet.right
                    || box.bottom <= crochet.top || box.top >= crochet.bottom;
            });
    })).toBe(true);
    await expect(page.locator("#btn-more")).toBeVisible();
    await page.locator("#btn-more").click();
    await expect(page.getByRole("menuitem", { name: "Pattern", exact: true })).toBeVisible();
    await page.getByRole("menuitem", { name: "Pattern", exact: true }).focus();
    await page.addStyleTag({ content: "html { font-size: 220%; }" });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    await expect(page.getByRole("menuitem", { name: "Pattern", exact: true })).toBeFocused();
    await page.getByRole("menuitem", { name: "Pattern", exact: true }).click();
    await expect(page.locator("#edit-pattern-widget")).toBeVisible();
});

test("geometry and extent samples use a common cell scale", async ({ page }) => {
    await page.emulateMedia({ reducedMotion: "reduce" });
    await bootApp(page);
    await page.locator("#btn-edit").click();
    const width = () => page.locator("#pattern-preview-canvas").evaluate((canvas: HTMLCanvasElement) => {
        const pixels = canvas.getContext("2d")!.getImageData(0, 0, canvas.width, canvas.height).data;
        let left = canvas.width, right = 0;
        for (let i = 0; i < pixels.length; i += 4) {
            if ((pixels[i] === 0 && pixels[i + 1] === 0 && pixels[i + 2] === 0)
                || (pixels[i] === 255 && pixels[i + 1] === 255 && pixels[i + 2] === 255)) {
                left = Math.min(left, i / 4 % canvas.width);
                right = Math.max(right, i / 4 % canvas.width);
            }
        }
        return right - left + 1;
    });
    const rows = await width();
    await page.getByText("Centre-out", { exact: true }).click();
    expect(Math.abs(await width() - rows)).toBeLessThanOrEqual(2);
    await page.getByText("Half", { exact: true }).click();
    expect(Math.abs(await width() - rows)).toBeLessThanOrEqual(2);
    await page.getByText("Quarter", { exact: true }).click();
    expect(Math.abs(await width() - rows * 4 / 7)).toBeLessThanOrEqual(2);
});

test("selection commands stay visible and unavailable commands cannot execute", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (const name of ["Copy", "Cut", "Paste", "Deselect"]) {
        await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await clickCell(page, 2, 1);
    await page.getByRole("button", { name: "Copy", exact: true }).click();
    await page.getByRole("button", { name: "Deselect", exact: true }).click();
    await page.getByRole("button", { name: "Select", exact: true }).click();
    for (const name of ["Copy", "Cut", "Deselect"]) {
        await expect(page.getByRole("button", { name, exact: true })).toBeVisible();
        await expect(page.getByRole("button", { name, exact: true })).toBeDisabled();
    }
    await expect(page.getByRole("button", { name: "Paste", exact: true })).toBeEnabled();
});

test("saved selection activation preserves the existing row and focused action", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    const row = await page.locator("#recipe-list > li").first().elementHandle();
    const action = page.getByRole("button", { name: "Selection 1 1 × 1" });
    await action.focus();
    await page.keyboard.press("Enter");
    await expect(action).toBeFocused();
    expect(await row!.evaluate(element => element.isConnected)).toBe(true);
});

test("deleting an earlier saved selection preserves focus on a surviving row", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Select", exact: true }).click();
    await clickCell(page, 1, 1);
    await page.locator("#recipe-create").click();
    await clickCell(page, 2, 1);
    await page.locator("#recipe-create").click();
    await clickCell(page, 3, 1);
    const survivor = page.locator("#recipe-list > li").nth(2);
    const row = await survivor.elementHandle();
    const activate = survivor.getByRole("button", { name: "Selection 3 1 × 1" });
    await activate.focus();
    await page.getByRole("button", { name: "Delete selection 1", exact: true })
        .evaluate((button: HTMLButtonElement) => button.click());
    await expect(page.locator("#recipe-list > li")).toHaveCount(3);
    await expect(page.getByRole("button", { name: "Selection 2 1 × 1" })).toBeFocused();
    expect(await row!.evaluate(element => element.isConnected)).toBe(true);
});

test("Open updates a mirror's types and coordinates when its identity is retained", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const project = await page.evaluate(() => {
        const recovery = JSON.parse(localStorage.getItem("mosaic-recovery")!);
        return {
            version: 3,
            ...recovery.document,
            axes: [{ id: recovery.workspace.mirrors[0].id, kind: "H", active: true, y: 2 }],
        };
    });
    const chooserPromise = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    await (await chooserPromise).setFiles({
        name: "horizontal-mirror.mcw",
        mimeType: "application/json",
        buffer: Buffer.from(JSON.stringify(project)),
    });
    const position = page.getByRole("spinbutton", { name: "Mirror centre y" });
    await expect(position).toBeVisible();
    await expect(position).toHaveValue("2");
    await expect(page.getByRole("spinbutton", { name: "Mirror centre x" })).toHaveValue("4");
    await expect(page.getByRole("button", { name: "Vertical", exact: true })).toHaveAttribute("aria-pressed", "false");
    await expect(page.getByRole("button", { name: "Horizontal", exact: true })).toHaveAttribute("aria-pressed", "true");
    await position.fill("3.5");
    await position.press("Enter");
    await expect(position).toHaveValue("3.5");
    await expect(position).toBeFocused();
    await expect.poll(() => page.evaluate(() =>
        JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors,
    )).toEqual([{ id: project.axes[0].id, enabled: true, x: 4, y: 3.5, types: ["H"] }]);
});

test("mirror updates preserve position fields, row identity, and focused actions", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
    const row = await page.locator("#sym-list > div").first().elementHandle();
    const position = page.getByRole("spinbutton", { name: "Mirror centre x" });
    await position.fill("3.5");
    await position.press("Enter");
    await expect(position).toBeFocused();
    await expect(position).toHaveValue("3.5");
    const toggle = page.getByRole("button", { name: "Disable Mirror 1 at (3.5, 4)" });
    await toggle.focus();
    await page.keyboard.press("Enter");
    await expect(page.getByRole("button", { name: "Enable Mirror 1 at (3.5, 4)" })).toBeFocused();
    expect(await row!.evaluate(element => element.isConnected)).toBe(true);
});

test("changing Crochet direction retains instruction row identity and focus", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-export").click();
    await expect(page.locator("#export-copy")).toBeEnabled();
    const item = page.locator("#instructions-units button").nth(2);
    const row = await item.elementHandle();
    await item.focus();
    await page.locator("#alternate").evaluate((input: HTMLInputElement) => {
        input.checked = true;
        input.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await expect(item).toBeFocused();
    expect(await row!.evaluate(element => element.isConnected)).toBe(true);
});

test("project semantic colours propagate to UI and undo restores the same palette", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-edit").click();
    await page.locator("#danger-color").fill("#101010");
    await page.locator("#danger-color").dispatchEvent("change");
    await page.locator("#accent-color").fill("#ffffff");
    await page.locator("#accent-color").dispatchEvent("change");
    const palette = () => page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return [style.getPropertyValue("--danger").trim(), style.getPropertyValue("--accent").trim()];
    });
    expect(await palette()).toEqual(["#101010", "#ffffff"]);
    await page.locator("#btn-undo").click();
    expect(await palette()).toEqual(["#101010", "#d653a3"]);
});

test("Pattern icon actions expose concise names and project colours reach UI feedback", async ({ page }) => {
    await bootApp(page);
    await page.getByRole("button", { name: "Pattern", exact: true }).click();
    for (const name of ["Yarn A", "Yarn B", "Danger", "Accent"]) {
        await expect(page.getByLabel(name, { exact: true }).and(page.locator('input[type="color"]'))).toBeVisible();
    }
    const find = page.getByRole("button", { name: "Find contrast", exact: true });
    const clear = page.getByRole("button", { name: "Clear design", exact: true });
    await expect(find).toHaveText("");
    await expect(clear).toHaveText("");
    await expect(clear).toHaveAttribute("title", /drawing, selections, repeats, and mirrors/);
    await page.getByLabel("Danger", { exact: true }).fill("#101010");
    await page.getByLabel("Accent", { exact: true }).fill("#ffffff");
    expect(await page.evaluate(() => {
        const style = getComputedStyle(document.documentElement);
        return [style.getPropertyValue("--danger").trim(), style.getPropertyValue("--accent").trim()];
    })).toEqual(["#101010", "#ffffff"]);
    await find.click();
    await expect(page.getByLabel("Danger", { exact: true })).not.toHaveValue("#101010");
});
