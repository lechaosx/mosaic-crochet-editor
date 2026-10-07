import { expect, test } from "@playwright/test";
import { bootApp, clickCell, pixelRGB, cellCoord } from "./_helpers";

for (const [width, fontSize] of [[1440, 16], [390, 16], [1280, 32]]) {
    test(`variant tools share the ordinary icon footprint at ${width}px and ${fontSize}px text`, async ({ page }) => {
        await page.setViewportSize({ width, height: 960 });
        await bootApp(page);
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
        const ordinary = (await page.locator("#tool-pencil").boundingBox())!;
        const dock = (await page.locator("#authoring-dock").boundingBox())!;
        for (const id of ["swatch-a", "swatch-b"]) {
            const swatch = (await page.locator(`#${id}`).boundingBox())!;
            expect(swatch.x).toBeGreaterThanOrEqual(dock.x);
            expect(swatch.x + swatch.width).toBeLessThanOrEqual(dock.x + dock.width);
        }
        for (const [id, family] of [["select", "Rectangle"], ["wand", "Wand"], ["move", "Move"], ["overlay", "Overlay"]]) {
            const tool = page.locator(`#tool-${id}`);
            const primary = (await tool.boundingBox())!;
            const group = await tool.evaluate(element => {
                const rect = element.parentElement!.getBoundingClientRect();
                return { width: rect.width, height: rect.height };
            });
            expect(primary.width).toBeCloseTo(ordinary.width, 0);
            expect(primary.height).toBeCloseTo(ordinary.height, 0);
            expect(group.width).toBeCloseTo(ordinary.width, 0);
            expect(group.height).toBeCloseTo(ordinary.height, 0);
            const indicator = page.getByRole("button", { name: `${family} variants`, exact: true });
            await expect(indicator).toBeVisible();
            await indicator.click();
            await expect(page.getByRole("menu", { name: `${family} variants`, exact: true })).toBeVisible();
            await page.keyboard.press("Escape");
            await expect(indicator).toBeFocused();
            await expect(page.locator("#tool-pencil")).toHaveAttribute("aria-pressed", "true");
        }
    });
}

test("global mirrors use one focused editor while disabled centres remain editable", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true }).click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await expect(page.getByRole("spinbutton", { name: "Mirror centre x" })).toHaveCount(1);
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    const rows = page.locator("#sym-list > .sym-list-row");
    await expect(rows).toHaveCount(2);
    await expect(rows.getByRole("spinbutton")).toHaveCount(0);
    await rows.first().getByRole("button", { name: "Select Mirror 1 at (4, 4)", exact: true }).click();
    await expect(page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true })).toHaveAttribute("aria-pressed", "true");
    await rows.first().getByRole("button", { name: "Disable Mirror 1 at (4, 4)", exact: true }).click();
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    await x.fill("3"); await x.press("Enter");
    await expect(x).toBeFocused();
    await expect(x).toHaveValue("3");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0]))
        .toMatchObject({ x: 3, enabled: false, types: ["V"] });
    await rows.first().getByRole("button", { name: "Delete Mirror 1 at (3, 4)", exact: true }).click();
    await expect(rows.first().getByRole("button", { name: "Delete Mirror 1 at (4, 4)", exact: true })).toBeFocused();
    await expect(x).toHaveValue("4");
    await expect(page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true })).toHaveAttribute("aria-pressed", "true");
});

test("unapplied centre coordinate pairs reset on Escape and window blur", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    const y = page.getByRole("spinbutton", { name: "Mirror centre y" });
    const history = await page.evaluate(() => localStorage.getItem("mosaic-history"));
    await x.fill("2.5"); await y.fill("3.5"); await y.press("Escape");
    await expect(x).toHaveValue("4"); await expect(y).toHaveValue("4");
    await expect(page.getByRole("button", { name: "Add mirror", exact: true })).toBeVisible();
    await x.fill("1"); await page.evaluate(() => window.dispatchEvent(new Event("blur")));
    await expect(x).toHaveValue("4");
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toEqual(history);
});

test("implied types belong to one centre, remain explicit toggles, and are never saved implicitly", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    const point = page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Point symmetry (180°)", exact: true });
    await expect(point).toHaveAttribute("aria-pressed", "false");
    await expect(point).toHaveAccessibleDescription(/Implied/);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0].types)).toEqual(["V", "H"]);
    const count = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length);
    await point.click();
    await expect(point).toHaveAttribute("aria-pressed", "true");
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-history")!).snapshots.length)).toBe(count + 1);
    await point.click();
    await expect(point).toHaveAccessibleDescription(/Implied/);
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    await expect(point).not.toHaveAccessibleDescription(/Implied/);
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    await expect(point).not.toHaveAccessibleDescription(/Implied/);
    await page.reload(); await page.waitForFunction(() => !!window.__test_matrix__);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors.map((mirror: { types: string[] }) => mirror.types)))
        .toEqual([["V"], ["H"]]);
});

test("implied presentation preserves clipped global drawing around off-centre mirrors", async ({ page }) => {
    await bootApp(page);
    const chooser = page.waitForEvent("filechooser");
    await page.locator("#btn-load").click();
    await (await chooser).setFiles({ name: "narrow.mcw", mimeType: "application/json", buffer: Buffer.from(JSON.stringify({
        version: 1, state: { mode: "row", canvasWidth: 9, canvasHeight: 3 },
        pixels: Array.from({ length: 27 }, (_, index) => Math.floor(index / 9) % 2 + 1), colorA: "#000000", colorB: "#ffffff",
    })) });
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    const x = page.getByRole("spinbutton", { name: "Mirror centre x" });
    const y = page.getByRole("spinbutton", { name: "Mirror centre y" });
    await x.fill("4"); await y.fill("1"); await y.press("Enter");
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Diagonal", exact: true }).click();
    await expect(page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true })).toHaveAccessibleDescription(/Implied/);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Settings", exact: true }).click();
    await page.locator("label:has(#lock-invalid)").click();
    await page.keyboard.press("Escape");
    await page.locator("#swatch-b").click();
    await clickCell(page, 0, 0);
    for (const x of [0, 8]) {
        const target = await cellCoord(page, x, 0);
        expect(await pixelRGB(page, target.cx, target.cy)).toEqual([255, 255, 255]);
    }
    const impliedTarget = await cellCoord(page, 0, 2);
    expect(await pixelRGB(page, impliedTarget.cx, impliedTarget.cy)).toEqual([0, 0, 0]);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors[0].types)).toEqual(["V", "D1"]);
    await page.locator("#btn-sym-toggle").click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    await page.locator("#btn-sym-toggle").click();
    await page.locator("#swatch-a").click(); await clickCell(page, 0, 0);
    await page.locator("#swatch-b").click(); await clickCell(page, 0, 0);
    expect(await pixelRGB(page, impliedTarget.cx, impliedTarget.cy)).toEqual([255, 255, 255]);
});

test.describe("phone mirror editing", () => {
    test.use({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true });
    for (const fontSize of [16, 24]) test(`canvas centre and all editor controls remain reachable with ${fontSize}px text`, async ({ page }) => {
        await bootApp(page);
        await page.evaluate(size => { document.documentElement.style.fontSize = `${size}px`; }, fontSize);
        await page.locator("#tool-select").tap();
        await page.getByRole("button", { name: "Close inspector", exact: true }).tap();
        await clickCell(page, 1, 1);
        await page.locator("#btn-sym-toggle").tap();
        await page.getByRole("button", { name: "Add mirror", exact: true }).tap();
        await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true }).tap();
        const centre = await cellCoord(page, 4, 4);
        expect(await page.evaluate(({ cx, cy }) =>
            [[0, 0], [-18, 0], [18, 0], [0, -18], [0, 18]].every(([dx, dy]) =>
                document.elementFromPoint(cx + dx, cy + dy)?.id === "canvas"), centre)).toBe(true);
        const matrix = await page.evaluate(() => window.__test_matrix__!.toString());
        const inspector = (await page.locator("#inspector-host").boundingBox())!;
        for (const target of [page.getByRole("spinbutton", { name: "Mirror centre x" }),
            page.getByRole("spinbutton", { name: "Mirror centre y" }),
            ...["Apply centre position", "Vertical", "Horizontal", "Diagonal", "Anti-diagonal", "Point symmetry (180°)", "Stamp copies"]
                .map(name => page.getByRole("button", { name, exact: true }))]) {
            await expect(target).toBeEnabled();
            await target.focus();
            await expect(target).toBeFocused();
            const box = (await target.boundingBox())!;
            expect(box.y).toBeGreaterThanOrEqual(inspector.y);
            expect(box.y + box.height).toBeLessThanOrEqual(inspector.y + inspector.height + 0.5);
        }
        expect(await page.evaluate(() => window.__test_matrix__!.toString())).toEqual(matrix);
    });
});

test("coincident mirrors remain distinguishable by accessible identity and chosen types after deletion and Undo", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Vertical", exact: true }).click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: "Horizontal", exact: true }).click();
    const first = page.getByRole("button", { name: "Select Mirror 1 at (4, 4)", exact: true });
    const second = page.getByRole("button", { name: "Select Mirror 2 at (4, 4)", exact: true });
    await expect(first).toHaveAccessibleDescription("Vertical");
    await expect(second).toHaveAccessibleDescription("Horizontal");
    const row = await page.locator("#sym-list > .sym-list-row").last().elementHandle();
    await page.getByRole("button", { name: "Delete Mirror 1 at (4, 4)", exact: true }).click();
    await expect(page.getByRole("button", { name: "Delete Mirror 1 at (4, 4)", exact: true })).toBeFocused();
    await expect(page.getByRole("button", { name: "Select Mirror 1 at (4, 4)", exact: true })).toHaveAccessibleDescription("Horizontal");
    expect(await row!.evaluate(element => element.isConnected)).toBe(true);
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(first).toHaveAccessibleDescription("Vertical");
    await expect(second).toHaveAccessibleDescription("Horizontal");
});

test("mirror types live directly on their centre row and implied types look active", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click();
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    const row = page.locator(".sym-list-row.is-selected");
    await expect(row.getByRole("button", { name: "Vertical", exact: true })).toBeVisible();
    await row.getByRole("button", { name: "Vertical", exact: true }).click();
    await row.getByRole("button", { name: "Horizontal", exact: true }).click();
    const point = row.getByRole("button", { name: "Point symmetry (180°)", exact: true });
    await expect(point).toHaveAttribute("data-effective", "true");
    await expect(point).toHaveAttribute("aria-pressed", "false");
    await expect(page.locator("#mirror-type-hint")).toHaveCount(0);
});
