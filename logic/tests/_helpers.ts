import { initialize_row_pattern } from "@mosaic/wasm";
import type { PatternState, Float } from "../src/types";
import type { SessionState } from "../src/store";

export function rowPattern(W: number, H: number): PatternState {
    return { mode: "row", canvasWidth: W, canvasHeight: H };
}

export function rowSession(W: number, H: number, opts: Partial<SessionState> = {}): SessionState {
    return {
        pattern: rowPattern(W, H),
        pixels: initialize_row_pattern(W, H),
        colorA: "#000000",
        colorB: "#ffffff",
        activeTool: "pencil",
        primaryColor: 1,
        symmetry: new Set(),
        hlOpacity: 100,
        invalidIntensity: 65,
        float: null,
        labelsVisible: true,
        lockInvalid: false,
        rotation: 0,
        ...opts,
    };
}

export function maskOf(W: number, H: number, cells: [number, number][]): Uint8Array {
    const m = new Uint8Array(W * H);
    for (const [x, y] of cells) m[y * W + x] = 1;
    return m;
}

export function filledPixels(W: number, H: number, value: 1 | 2): Uint8Array {
    const p = initialize_row_pattern(W, H);
    for (let i = 0; i < p.length; i++) if (p[i] !== 0) p[i] = value;
    return p;
}

export function makeFloat(
    W: number, H: number,
    cells: { x: number; y: number; v: 1 | 2 }[],
    dx = 0, dy = 0,
): Float {
    const mask = new Uint8Array(W * H);
    const pixels = new Uint8Array(W * H);
    for (const { x, y, v } of cells) {
        mask[y * W + x] = 1;
        pixels[y * W + x] = v;
    }
    return { mask, pixels, dx, dy };
}
