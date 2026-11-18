// E2E helpers. All cell-relative actions go through `window.__test_matrix__`
// (exposed by `render.ts` per frame) so view state — pan/zoom/rotation —
// doesn't leak into tests.

import { Page } from "@playwright/test";

export async function addGlobalMirror(page: Page, type: string) {
    await page.getByRole("button", { name: "Add mirror", exact: true }).click();
    await page.locator(".sym-list-row.is-selected").getByRole("button", { name: type, exact: true }).click();
}

export async function chooseToolVariant(page: Page, family: string, variant: string) {
    await page.locator(`#tool-${family === "Rectangle" ? "select" : family === "Wand" ? "wand" : family === "Move" ? "move" : "overlay"}`).press("ArrowDown");
    await page.getByRole("menu", { name: `${family} variants`, exact: true })
        .getByRole("menuitemradio", { name: variant, exact: true }).click();
}

export async function selectionHandleCoords(page: Page): Promise<{ cx: number; cy: number }[]> {
    await page.evaluate(() => {
        const target = window as unknown as { selectionGrips?: { cx: number; cy: number }[] };
        if (target.selectionGrips) return;
        target.selectionGrips = [];
        // The renderer sets the test matrix once per frame, before drawing any grip.
        let current = window.__test_matrix__;
        Object.defineProperty(window, "__test_matrix__", { configurable: true, get: () => current, set(value) {
            current = value; target.selectionGrips = [];
        } });
        const proto = CanvasRenderingContext2D.prototype, arc = proto.arc;
        proto.arc = function (x, y, radius, start, end, ccw) {
            const matrix = this.getTransform(), scale = Math.hypot(matrix.a, matrix.b) / devicePixelRatio;
            if (this.canvas.id === "canvas" && radius * scale >= 8) {
                const point = matrix.transformPoint({ x, y }), bounds = this.canvas.getBoundingClientRect();
                target.selectionGrips!.push({ cx: point.x / devicePixelRatio + bounds.left, cy: point.y / devicePixelRatio + bounds.top });
            }
            arc.call(this, x, y, radius, start, end, ccw);
        };
    });
    await page.getByRole("button", { name: "Fit view", exact: true }).click();
    return page.evaluate(() => (window as unknown as { selectionGrips: { cx: number; cy: number }[] }).selectionGrips);
}

declare global {
    interface Window {
        __test_matrix__?: DOMMatrix;
        __test_instruction_seam_geometry__?: {
            edges: number[][];
            triangle: number[][];
            screenTriangle: number[][];
            outline: number[][];
        } | null;
        __test_instruction_yields__?: readonly { index: number; recomputed: boolean }[];
        __test_on_instruction_yield__?: (yielded: { index: number; recomputed: boolean }) => void;
    }
}

// CSS-px coord of cell (x, y)'s centre on the rendered canvas.
export async function cellCoord(page: Page, x: number, y: number): Promise<{ cx: number; cy: number }> {
    await page.waitForFunction(() => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const dpr = window.devicePixelRatio || 1;
        return canvas.width === Math.max(1, Math.round(canvas.clientWidth * dpr))
            && canvas.height === Math.max(1, Math.round(canvas.clientHeight * dpr));
    });
    return page.evaluate(({ x, y }) => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const m = window.__test_matrix__;
        if (!m) throw new Error("test matrix hook missing");
        const cx = m.a * (x + 0.5) + m.c * (y + 0.5) + m.e;
        const cy = m.b * (x + 0.5) + m.d * (y + 0.5) + m.f;
        const dpr = window.devicePixelRatio || 1;
        return { cx: cx / dpr + rect.left, cy: cy / dpr + rect.top };
    }, { x, y });
}

// The chart as displayed, as RGBA rows of `rect` (default: all of it) in
// device pixels of `#canvas`: the WebGL layer with the Canvas 2D overlay on
// top. Every chart pixel assertion reads through these helpers, so specs
// don't depend on how the chart's layers are drawn.
export async function chartPixels(page: Page, rect?: { x: number; y: number; width: number; height: number }) {
    const { width, height, base64 } = await page.evaluate(rect => {
        const overlay = document.getElementById("canvas") as HTMLCanvasElement;
        const { x, y, width, height } = rect ?? { x: 0, y: 0, width: overlay.width, height: overlay.height };
        const composite = document.createElement("canvas");
        composite.width = width;
        composite.height = height;
        const context = composite.getContext("2d", { willReadFrequently: true })!;
        // A presented WebGL frame is no longer readable; repaint it in this task.
        (window as typeof window & { __test_repaint_chart__?: (x: number, y: number, width: number, height: number) => void })
            .__test_repaint_chart__?.(x, y, width, height);
        for (const layer of [document.getElementById("chart-gl") as HTMLCanvasElement, overlay]) {
            context.drawImage(layer, x, y, width, height, 0, 0, width, height);
        }
        const data = context.getImageData(0, 0, width, height).data;
        // Base64 crosses the protocol far faster than a whole-canvas array.
        let binary = "";
        for (let i = 0; i < data.length; i += 0x8000) binary += String.fromCharCode(...data.subarray(i, i + 0x8000));
        return { width, height, base64: btoa(binary) };
    }, rect);
    return { width, height, data: Uint8Array.from(atob(base64), char => char.charCodeAt(0)) };
}

// [r, g, b, a] of the chart's device pixel (x, y).
export async function chartPixel(page: Page, x: number, y: number): Promise<number[]> {
    return Array.from((await chartPixels(page, { x, y, width: 1, height: 1 })).data);
}

// [r, g, b] of the chart pixel at CSS-px (cx, cy).
export async function pixelRGB(page: Page, cx: number, cy: number): Promise<[number, number, number]> {
    const { x, y } = await page.locator("#canvas").evaluate((canvas, { cx, cy }) => {
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        return { x: Math.round((cx - rect.left) * dpr), y: Math.round((cy - rect.top) * dpr) };
    }, { cx, cy });
    const [r, g, b] = await chartPixel(page, x, y);
    return [r, g, b];
}

// `page.mouse.click` doesn't accept modifiers — we wrap with explicit
// keyboard down/up so callers can simulate Shift / Ctrl / Alt chord clicks.
export async function clickCell(
    page: Page, x: number, y: number,
    opts: Parameters<Page["mouse"]["click"]>[2] & { modifiers?: ("Shift" | "Control" | "Alt")[] } = {},
) {
    const { cx, cy } = await cellCoord(page, x, y);
    const { modifiers = [], ...mouseOpts } = opts;
    for (const m of modifiers) await page.keyboard.down(m);
    await page.mouse.click(cx, cy, mouseOpts);
    for (const m of [...modifiers].reverse()) await page.keyboard.up(m);
}

// Drag from cell (sx,sy) to (ex,ey) with interpolated steps so the gesture
// state machine sees real pointermove events.
export async function dragCells(page: Page, sx: number, sy: number, ex: number, ey: number, mods: ("Shift" | "Control" | "Alt")[] = []) {
    const a = await cellCoord(page, sx, sy);
    const b = await cellCoord(page, ex, ey);
    for (const m of mods) await page.keyboard.down(m);
    await page.mouse.move(a.cx, a.cy);
    await page.mouse.down();
    await page.mouse.move(b.cx, b.cy, { steps: 10 });
    await page.mouse.up();
    for (const m of [...mods].reverse()) await page.keyboard.up(m);
}

export async function touchDragCells(page: Page, sx: number, sy: number, ex: number, ey: number) {
    const a = await cellCoord(page, sx, sy);
    const b = await cellCoord(page, ex, ey);
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: [{ x: a.cx, y: a.cy, id: 0 }],
    });
    for (let i = 1; i <= 10; i++) {
        await session.send("Input.dispatchTouchEvent", {
            type: "touchMove",
            touchPoints: [{
                x: a.cx + (b.cx - a.cx) * i / 10,
                y: a.cy + (b.cy - a.cy) * i / 10,
                id: 0,
            }],
        });
    }
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
}

export async function touchPanZoom(
    page: Page,
    start: [{ cx: number; cy: number }, { cx: number; cy: number }],
    end: [{ cx: number; cy: number }, { cx: number; cy: number }],
) {
    const session = await page.context().newCDPSession(page);
    await session.send("Input.dispatchTouchEvent", {
        type: "touchStart",
        touchPoints: start.map((p, id) => ({ x: p.cx, y: p.cy, id })),
    });
    await session.send("Input.dispatchTouchEvent", {
        type: "touchMove",
        touchPoints: end.map((p, id) => ({ x: p.cx, y: p.cy, id })),
    });
    await session.send("Input.dispatchTouchEvent", { type: "touchEnd", touchPoints: [] });
    await session.detach();
}

export async function bootApp(page: Page) {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__test_matrix__);
    if (await page.locator("#about-dialog").isVisible()) {
        await page.locator("#about-new").evaluate((button: HTMLButtonElement) => button.click());
        await page.locator("#about-dialog").waitFor({ state: "hidden" });
        await page.keyboard.press("Escape");
    }
}

// The helpers below keep the storage layout of the recovery, undo history and
// Crochet progress records out of the specs that observe them.

// Persisted record, parsed, or null when absent.
function storedRecord(page: Page, key: string): Promise<any> {
    return page.evaluate(key => {
        const raw = localStorage.getItem(key);
        return raw === null ? null : JSON.parse(raw);
    }, key);
}

export function storedRecovery(page: Page) {
    return storedRecord(page, "mosaic-recovery");
}

export function storedHistory(page: Page) {
    return storedRecord(page, "mosaic-history");
}

export async function storedHistoryLength(page: Page): Promise<number> {
    return (await storedHistory(page)).snapshots.length;
}

export function storedLiveProgress(page: Page) {
    return storedRecord(page, "mosaic-live-progress");
}

// From the next navigation on, writing the record throws as when storage is full.
function failWrites(page: Page, key: string) {
    return page.addInitScript(key => {
        const setItem = Storage.prototype.setItem;
        Storage.prototype.setItem = function (itemKey, value) {
            if (itemKey === key) throw new DOMException("full", "QuotaExceededError");
            return setItem.call(this, itemKey, value);
        };
    }, key);
}

export function failRecoveryWrites(page: Page) {
    return failWrites(page, "mosaic-recovery");
}

export function failLiveProgressWrites(page: Page) {
    return failWrites(page, "mosaic-live-progress");
}

// From the next navigation on, counts recovery writes since that page load.
// Returns a reader for the current count.
export async function countRecoveryWrites(page: Page): Promise<() => Promise<number>> {
    await page.addInitScript(() => {
        const setItem = Storage.prototype.setItem;
        let writes = 0;
        Storage.prototype.setItem = function (key, value) {
            if (key === "mosaic-recovery") writes++;
            return setItem.call(this, key, value);
        };
        Object.defineProperty(window, "__recoveryWriteCount", { get: () => writes });
    });
    return () => page.evaluate(() => (window as typeof window & { __recoveryWriteCount: number }).__recoveryWriteCount);
}
