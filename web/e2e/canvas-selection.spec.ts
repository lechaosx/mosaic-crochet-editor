import { expect, test, type Page } from "@playwright/test";
import { addGlobalMirror, bootApp, cellCoord, clickCell } from "./_helpers";

async function traceDrawing(page: Page) {
    await page.evaluate(() => {
        const proto = CanvasRenderingContext2D.prototype;
        const paths = new WeakMap<CanvasRenderingContext2D, number[][]>();
        const begin = proto.beginPath, move = proto.moveTo, line = proto.lineTo, stroke = proto.stroke, fill = proto.fillRect, arc = proto.arc;
        const target = window as unknown as { drawing: { paths: number[][]; dash: number[]; width: number; color: unknown }[] };
        target.drawing = [];
        const grips = window as unknown as { grips: { x: number; y: number }[] }; grips.grips = [];
        proto.arc = function (x, y, radius, start, end, ccw) {
            const matrix = this.getTransform(), scale = Math.hypot(matrix.a, matrix.b) / devicePixelRatio;
            if (this.canvas.id === "canvas" && radius * scale >= 8) {
                const point = matrix.transformPoint({ x, y }), bounds = this.canvas.getBoundingClientRect();
                grips.grips.push({ x: point.x / devicePixelRatio + bounds.left, y: point.y / devicePixelRatio + bounds.top });
            }
            arc.call(this, x, y, radius, start, end, ccw);
        };
        proto.beginPath = function () { paths.set(this, []); begin.call(this); };
        proto.moveTo = function (x, y) { paths.get(this)?.push([x, y]); move.call(this, x, y); };
        proto.lineTo = function (x, y) { paths.get(this)?.at(-1)?.push(x, y); line.call(this, x, y); };
        proto.fillRect = function (x, y, w, h) {
            if (this.canvas.id === "canvas" && w === this.canvas.width && h === this.canvas.height) { target.drawing = []; grips.grips = []; }
            fill.call(this, x, y, w, h);
        };
        proto.stroke = function (...args: Parameters<typeof stroke>) {
            if (this.canvas.id === "canvas") target.drawing.push({ paths: structuredClone(paths.get(this) ?? []),
                dash: this.getLineDash(), width: this.lineWidth, color: this.strokeStyle });
            stroke.apply(this, args);
        };
    });
}

async function selectSource(page: Page) {
    await bootApp(page);
    await page.keyboard.press("s");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await clickCell(page, 2, 2);
}

test("diagonally touching source cells have complete closed marching-ant loops", async ({ page }) => {
    await selectSource(page);
    await traceDrawing(page);
    await clickCell(page, 3, 3, { modifiers: ["Shift"] });
    const paths = await page.evaluate(() => (window as unknown as { drawing: { paths: number[][]; dash: number[] }[] })
        .drawing.filter(stroke => stroke.dash.length > 0).at(-1)!.paths);
    expect(paths).toHaveLength(2);
    expect(paths.every(path => path.length === 10 && path[0] === path.at(-2) && path[1] === path.at(-1))).toBe(true);
});

test("touching copies keep individual seams with one stroke per shared edge and a stronger animated source", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-right").press("Enter");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("p");
    await traceDrawing(page);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const drawing = await page.evaluate(() => (window as unknown as { drawing: { paths: number[][]; dash: number[]; width: number; color: string }[] }).drawing);
    const color = await page.locator("#accent-color").inputValue();
    const accent = drawing.filter(stroke => stroke.color.toLowerCase() === color.toLowerCase());
    expect(accent.some(stroke => stroke.dash.length === 0)).toBe(true);
    expect(accent.some(stroke => stroke.dash.length > 0)).toBe(true);
    const edges = accent.flatMap(stroke => stroke.paths.flatMap(path => Array.from({ length: path.length / 2 - 1 }, (_, i) =>
        [path.slice(i * 2, i * 2 + 2).join(","), path.slice(i * 2 + 2, i * 2 + 4).join(",")].sort().join("|"))));
    expect(new Set(edges).size).toBe(edges.length);
    expect(edges).toContain("3,2|3,3");
    expect(edges).toContain("4,2|4,3");
});

for (const tool of ["p", "f", "e", "i", "o", "s", "w", "m"]) test(`middle drag pans with ${tool} and modifiers without authored changes`, async ({ page }) => {
    await selectSource(page);
    await page.keyboard.press(tool);
    if (await page.locator("#inspector-host").isVisible()) await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    const before = await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"), recovery: localStorage.getItem("mosaic-recovery"),
        matrix: window.__test_matrix__!.toString() }));
    const at = await cellCoord(page, 4, 4);
    await page.keyboard.down("Shift"); await page.keyboard.down("Control"); await page.keyboard.down("Alt");
    await page.mouse.move(at.cx, at.cy); await page.mouse.down({ button: "middle" });
    await expect(page.locator("#status-action")).toBeHidden();
    await page.mouse.move(at.cx + 50, at.cy + 30); await page.mouse.up({ button: "middle" });
    await page.keyboard.up("Alt"); await page.keyboard.up("Control"); await page.keyboard.up("Shift");
    const after = await page.evaluate(() => ({ history: localStorage.getItem("mosaic-history"), recovery: localStorage.getItem("mosaic-recovery"),
        matrix: window.__test_matrix__!.toString() }));
    expect(after.history).toBe(before.history); expect(after.recovery).toBe(before.recovery);
    expect(after.matrix).not.toBe(before.matrix);
});

async function localMirror(page: Page) {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("label").filter({ has: page.getByRole("radio", { name: "Mirror", exact: true }) }).click();
    await page.locator("#recipe-mirror-centre-x").fill("3");
    await page.locator("#recipe-mirror-centre-y").fill("3");
    await page.locator("#recipe-mirror-centre-y").press("Enter");
    await page.locator("#recipe-mirror-v").click();
    await page.locator("#recipe-mirror-h").click();
    await page.locator("#btn-sym-toggle").click();
    await addGlobalMirror(page, "Vertical");
}

for (const tool of ["s", "w"]) test(`${tool} shows full local axes and hides global guides even with Mirrors open`, async ({ page }) => {
    await localMirror(page);
    await page.keyboard.press(tool);
    await page.locator("#btn-sym-toggle").click();
    await traceDrawing(page);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const paths = await page.evaluate(() => (window as unknown as { drawing: { paths: number[][] }[] }).drawing.flatMap(stroke => stroke.paths));
    expect(paths).toContainEqual([3.5, -1, 3.5, 10]);
    expect(paths).toContainEqual([-1, 3.5, 10, 3.5]);
    expect(paths).not.toContainEqual([4.5, -1, 4.5, 10]);
    await page.keyboard.press("p");
    await page.locator("#btn-sym-toggle").click();
    const paintPaths = await page.evaluate(() => (window as unknown as { drawing: { paths: number[][] }[] }).drawing.flatMap(stroke => stroke.paths));
    expect(paintPaths).not.toContainEqual([3.5, -1, 3.5, 10]);
    expect(paintPaths).toContainEqual([4.5, -1, 4.5, 10]);
});

for (const mode of ["Circle", "Mirror"] as const) test(`off-centre primary ${mode} grip preserves its centre until dragged; right click never drags`, async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("label").filter({ has: page.getByRole("radio", { name: mode, exact: true }) }).click();
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0]);
    const at = await cellCoord(page, 2, 2);
    await page.mouse.move(at.cx + 17, at.cy); await page.mouse.down();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0])).toEqual(before);
    await page.mouse.up();
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0])).toEqual(before);
    await page.mouse.move(at.cx, at.cy); await page.mouse.down({ button: "right" });
    await expect(page.locator("#status-action")).toContainText("Add");
    await page.mouse.up({ button: "right" });
    const after = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0]);
    expect(after.rotationCentreX).toBe(before.rotationCentreX); expect(after.mirrorCentreX).toBe(before.mirrorCentreX);
});

test("a new Rectangle preview hides the old source copies and their grips", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("#recipe-right").fill("2"); await page.locator("#recipe-right").press("Enter");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await traceDrawing(page);
    const at = await cellCoord(page, 6, 6);
    await page.mouse.move(at.cx, at.cy); await page.mouse.down();
    const color = await page.locator("#accent-color").inputValue();
    const paths = await page.evaluate(color => (window as unknown as { drawing: { paths: number[][]; color: string }[] }).drawing
        .filter(stroke => stroke.color.toLowerCase() === color.toLowerCase()).flatMap(stroke => stroke.paths), color);
    expect(paths.some(path => path.includes(2) || path.includes(3) || path.includes(4))).toBe(false);
    await page.mouse.up();
});

test("a Grid grip edge click preserves spacing and history before a deliberate drag", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    const before = await page.evaluate(() => ({ recipe: JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0],
        history: localStorage.getItem("mosaic-history") }));
    await traceDrawing(page);
    for (let i = 0; i < 5; i++) await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const at = await page.evaluate(() => (window as unknown as { grips: { x: number; y: number }[] }).grips[0]);
    await page.mouse.move(at.x + 20, at.y); await page.mouse.down();
    await expect(page.locator("#recipe-gap-x")).toHaveValue("0");
    await expect(page.locator("#recipe-column-offset")).toHaveValue("0");
    await page.mouse.up();
    expect(await page.evaluate(() => localStorage.getItem("mosaic-history"))).toBe(before.history);
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.recipes[0])).toEqual(before.recipe);
});

test("source marching ants remain visibly animated with white Accent", async ({ page }) => {
    await selectSource(page);
    await traceDrawing(page);
    await page.locator("#btn-edit").click();
    await page.locator("#accent-color").fill("#ffffff");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("p");
    await page.waitForTimeout(200);
    const bitmap = () => page.locator("#canvas").evaluate((canvas: HTMLCanvasElement) => {
        const matrix = window.__test_matrix__!, top = matrix.transformPoint({ x: 2, y: 2 });
        const width = Math.floor(matrix.a) - 12;
        return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(top.x) + 6, Math.floor(top.y) - 3, width, 7).data);
    });
    const before = await bitmap();
    await expect.poll(async () => {
        const next = await bitmap();
        return Math.max(...next.map((value, i) => Math.abs(value - before[i])));
    }).toBeGreaterThan(100);
});

test("a Grid drag following a numeric edit has its own Undo action", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("#recipe-gap-x").fill("1"); await page.locator("#recipe-gap-x").press("Enter");
    await traceDrawing(page);
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    const at = await page.evaluate(() => (window as unknown as { grips: { x: number; y: number }[] }).grips[0]);
    const step = await page.evaluate(() => window.__test_matrix__!.a / devicePixelRatio);
    await page.mouse.move(at.x, at.y); await page.mouse.down();
    await page.mouse.move(at.x + step, at.y); await page.mouse.up();
    await expect(page.locator("#recipe-gap-x")).toHaveValue("2");
    await page.keyboard.press("Control+z");
    await expect(page.locator("#recipe-gap-x")).toHaveValue("1");
});

test("right clicks at a global mirror grip execute the chosen tool alternative", async ({ page }) => {
    await bootApp(page);
    await page.locator("#btn-sym-toggle").click(); await addGlobalMirror(page, "Vertical");
    const before = await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors);
    const at = await cellCoord(page, 4, 4), end = await cellCoord(page, 5, 4);
    await page.mouse.move(at.cx, at.cy); await page.mouse.down({ button: "right" });
    await expect(page.locator("#status-action")).toContainText("Pencil · Yarn B");
    await page.mouse.move(end.cx, end.cy); await page.mouse.up({ button: "right" });
    expect(await page.evaluate(() => JSON.parse(localStorage.getItem("mosaic-recovery")!).workspace.mirrors)).toEqual(before);
});
