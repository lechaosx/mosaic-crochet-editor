// E2E helpers. All cell-relative actions go through `window.__test_matrix__`
// (exposed by `render.ts` per frame) so view state — pan/zoom/rotation —
// doesn't leak into tests.

import { Page } from "@playwright/test";

declare global {
    interface Window { __test_matrix__?: DOMMatrix }
}

// CSS-px coord of cell (x, y)'s centre on the rendered canvas.
export async function cellCoord(page: Page, x: number, y: number): Promise<{ cx: number; cy: number }> {
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

// [r, g, b] of the canvas pixel at CSS-px (cx, cy). Renderer paints with
// `alpha: false`, so we ignore the alpha channel.
export async function pixelRGB(page: Page, cx: number, cy: number): Promise<[number, number, number]> {
    return page.evaluate(({ cx, cy }) => {
        const canvas = document.getElementById("canvas") as HTMLCanvasElement;
        const rect = canvas.getBoundingClientRect();
        const dpr = window.devicePixelRatio || 1;
        const px = Math.round((cx - rect.left) * dpr);
        const py = Math.round((cy - rect.top) * dpr);
        const data = canvas.getContext("2d", { willReadFrequently: true })!
            .getImageData(px, py, 1, 1).data;
        return [data[0], data[1], data[2]];
    }, { cx, cy });
}

export async function clickCell(page: Page, x: number, y: number, opts: Parameters<Page["mouse"]["click"]>[2] = {}) {
    const { cx, cy } = await cellCoord(page, x, y);
    await page.mouse.click(cx, cy, opts);
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

export async function bootApp(page: Page) {
    await page.goto("/");
    await page.waitForFunction(() => !!window.__test_matrix__);
}
