import { expect, test, type Page } from "@playwright/test";
import { addGlobalMirror, bootApp, cellCoord, clickCell } from "./_helpers";

interface DrawingStroke { paths: number[][]; dash: number[]; width: number; color: string; alpha: number; offset: number; scale: number }

async function traceDrawing(page: Page) {
    await page.evaluate(() => {
        const proto = CanvasRenderingContext2D.prototype;
        const paths = new WeakMap<CanvasRenderingContext2D, number[][]>();
        const begin = proto.beginPath, move = proto.moveTo, line = proto.lineTo, stroke = proto.stroke, fill = proto.fillRect, arc = proto.arc;
        const target = window as unknown as { drawing: DrawingStroke[] };
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
                dash: this.getLineDash(), width: this.lineWidth, color: this.strokeStyle as string,
                alpha: this.globalAlpha, offset: this.lineDashOffset, scale: Math.hypot(this.getTransform().a, this.getTransform().b) });
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

test("touching copies use dimmed original marching ants and one stroke per shared edge", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("#recipe-right").fill("2");
    await page.locator("#recipe-right").press("Enter");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("p");
    await traceDrawing(page);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const drawing = await page.evaluate(() => (window as unknown as { drawing: DrawingStroke[] }).drawing);
    const color = await page.locator("#accent-color").inputValue();
    const accent = drawing.filter(stroke => stroke.color.toLowerCase() === color.toLowerCase());
    expect(accent).toHaveLength(3);
    expect(accent.map(stroke => stroke.alpha)).toEqual([0.65, 0.65, 1]);
    for (const stroke of accent) {
        expect(stroke.dash).toHaveLength(2);
        for (const value of stroke.dash) expect(value * stroke.scale).toBeCloseTo(6);
        expect(stroke.width * stroke.scale).toBeCloseTo(3);
    }
    const selectionPaths = new Set(accent.map(stroke => JSON.stringify(stroke.paths)));
    expect(drawing.filter(stroke => selectionPaths.has(JSON.stringify(stroke.paths)))).toEqual(accent);
    const edges = accent.flatMap(stroke => stroke.paths.flatMap(path => Array.from({ length: path.length / 2 - 1 }, (_, i) =>
        [path.slice(i * 2, i * 2 + 2).join(","), path.slice(i * 2 + 2, i * 2 + 4).join(",")].sort().join("|"))));
    expect(new Set(edges).size).toBe(edges.length);
    expect(edges).toContain("3,2|3,3");
    expect(edges).toContain("4,2|4,3");
});

for (const directions of [["left"], ["left", "right", "up", "down"]]) test(`copy dash phase follows its original perimeter across suppressed ${directions.length === 1 ? "middle" : "prefix"} edges`, async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    for (const direction of directions) {
        await page.locator(`#recipe-${direction}`).fill("1"); await page.locator(`#recipe-${direction}`).press("Enter");
    }
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("p");
    await traceDrawing(page);
    await page.getByRole("button", { name: "Zoom in", exact: true }).click();
    const color = await page.locator("#accent-color").inputValue();
    const { strokes, originals } = await page.evaluate(color => ({
        strokes: (window as unknown as { drawing: DrawingStroke[] }).drawing.filter(stroke => stroke.color.toLowerCase() === color.toLowerCase()),
        originals: (window as unknown as { __test_repeat_outlines__: { paths: number[][][] } }).__test_repeat_outlines__.paths.flat(),
    }), color);
    const source = strokes.at(-1)!;
    const owners = new Map<number[], number>();
    let skippedPrefix = false;
    for (const stroke of strokes.slice(0, -1)) for (const run of stroke.paths) {
        const original = originals.find(path => {
            for (let i = 0; i < path.length - 2; i += 2) {
                if (run.every((value, j) => value === path[i + j])) return true;
            }
            return false;
        });
        expect(original).toBeDefined();
        owners.set(original!, (owners.get(original!) ?? 0) + 1);
        let distance = 0;
        for (let i = 0; i < original!.length - 2; i += 2) {
            if (original![i] === run[0] && original![i + 1] === run[1]) break;
            distance += Math.hypot(original![i + 2] - original![i], original![i + 3] - original![i + 1]);
        }
        skippedPrefix ||= distance > 0;
        expect(stroke.offset).toBeCloseTo(source.offset + distance);
    }
    expect(skippedPrefix).toBe(true);
    if (directions.length === 1) expect([...owners.values()].some(count => count > 1)).toBe(true);
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

test("Rectangle sweeps retain the original dimmed drag-preview marching ants", async ({ page }) => {
    await selectSource(page);
    await traceDrawing(page);
    const start = await cellCoord(page, 5, 5), end = await cellCoord(page, 6, 6);
    await page.mouse.move(start.cx, start.cy); await page.mouse.down(); await page.mouse.move(end.cx, end.cy);
    const color = await page.locator("#accent-color").inputValue();
    const strokes = await page.evaluate(color => (window as unknown as { drawing: DrawingStroke[] }).drawing
        .filter(stroke => stroke.color.toLowerCase() === color.toLowerCase()), color);
    expect(strokes.map(stroke => stroke.alpha)).toEqual([1, 0.45]);
    for (const stroke of strokes) {
        expect(stroke.width * stroke.scale).toBeCloseTo(3);
        expect(stroke.dash).toHaveLength(2);
        for (const value of stroke.dash) expect(value * stroke.scale).toBeCloseTo(6);
    }
    await page.mouse.up();
});

test("Grid renders no grips or labels while Circle and Mirror retain centre grips", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await traceDrawing(page);
    await page.evaluate(() => {
        const proto = CanvasRenderingContext2D.prototype, fill = proto.fillText;
        const target = window as unknown as { gridLabels: string[] }; target.gridLabels = [];
        proto.fillText = function (text, ...args: Parameters<typeof fill> extends [string, ...infer A] ? A : never) {
            if (this.canvas.id === "canvas" && /Columns|Rows/.test(text)) target.gridLabels.push(text);
            fill.call(this, text, ...args);
        };
    });
    await page.getByRole("button", { name: "Zoom out", exact: true }).click();
    expect(await page.evaluate(() => (window as unknown as { grips: unknown[] }).grips)).toEqual([]);
    expect(await page.evaluate(() => (window as unknown as { gridLabels: string[] }).gridLabels)).toEqual([]);
    for (const mode of ["Circle", "Mirror"]) {
        await page.locator("label").filter({ has: page.getByRole("radio", { name: mode, exact: true }) }).click();
        expect(await page.evaluate(() => (window as unknown as { grips: unknown[] }).grips)).toHaveLength(1);
    }
});

for (const reducedMotion of [false, true]) test(`source and copy marching ants ${reducedMotion ? "stop with reduced motion" : "both visibly animate"}`, async ({ page }) => {
    await page.emulateMedia({ reducedMotion: reducedMotion ? "reduce" : "no-preference" });
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("#recipe-right").fill("1"); await page.locator("#recipe-right").press("Enter");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await traceDrawing(page);
    await page.locator("#btn-edit").click();
    await page.locator("#accent-color").fill("#ff0066");
    await page.getByRole("button", { name: "Close inspector", exact: true }).click();
    await page.keyboard.press("p");
    await page.waitForTimeout(200);
    const frame = () => page.locator("#canvas").evaluate((canvas: HTMLCanvasElement) => {
        const matrix = window.__test_matrix__!;
        return [2, 3].map(x => {
            const top = matrix.transformPoint({ x, y: 2 }), width = Math.floor(matrix.a) - 12;
            return Array.from(canvas.getContext("2d")!.getImageData(Math.floor(top.x) + 6, Math.floor(top.y) - 2, width, 5).data);
        });
    });
    const before = await frame();
    if (reducedMotion) {
        await page.waitForTimeout(250);
        expect(await frame()).toEqual(before);
    } else {
        for (const index of [0, 1]) await expect.poll(async () => {
            const next = (await frame())[index];
            return Math.max(...next.map((value, i) => Math.abs(value - before[index][i])));
        }).toBeGreaterThan(100);
    }
});

test("Grid numeric spacing edits coalesce for Undo", async ({ page }) => {
    await selectSource(page);
    await page.locator("#tool-select").click();
    await page.locator("#recipe-gap-x").fill("1"); await page.locator("#recipe-gap-x").press("Enter");
    await page.locator("#recipe-column-offset").fill("2"); await page.locator("#recipe-column-offset").press("Enter");
    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(page.locator("#recipe-gap-x")).toHaveValue("0");
    await expect(page.locator("#recipe-column-offset")).toHaveValue("0");
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

for (const dpr of [1, 3]) test.describe(`touching Grid copies at DPR ${dpr}`, () => {
    test.use({ deviceScaleFactor: dpr });

    test("Rectangle keeps shared copy borders visibly marching at low zoom", async ({ page }) => {
        await selectSource(page);
        await page.locator("#tool-select").click();
        for (const [field, value] of [["right", "3"], ["down", "2"]]) {
            await page.locator(`#recipe-${field}`).fill(value);
            await page.locator(`#recipe-${field}`).press("Enter");
        }
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        await page.locator("#btn-edit").click();
        await page.locator("#accent-color").fill("#ff0066");
        await page.getByRole("button", { name: "Close inspector", exact: true }).click();
        while (await page.evaluate(() => window.__test_matrix__!.a / devicePixelRatio) > 29) {
            await page.getByRole("button", { name: "Zoom out", exact: true }).click();
        }
        const frames: boolean[][] = [];
        for (let frame = 0; frame < 6; frame++) {
            frames.push(await page.locator("#canvas").evaluate((canvas: HTMLCanvasElement) => {
                const m = window.__test_matrix__!, ctx = canvas.getContext("2d")!;
                const start = m.transformPoint({ x: 4, y: 3 }), end = m.transformPoint({ x: 4, y: 4 });
                return Array.from({ length: Math.floor(end.y - start.y) - 4 }, (_, index) => {
                    const pixel = ctx.getImageData(Math.floor(start.x), Math.floor(start.y) + index + 2, 1, 1).data;
                    return pixel[0] - pixel[1] > 30;
                });
            }));
            await page.waitForTimeout(110);
        }
        const covered = frames[0].filter((_, index) => frames.some(frame => frame[index])).length;
        expect(covered).toBeGreaterThan(frames[0].length / 2);
    });
});
