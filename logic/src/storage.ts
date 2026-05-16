import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import { PatternState } from "./types";

// In-memory pixel encoding: 0 = inner hole, 1 = COLOR_A, 2 = COLOR_B.
// On disk we pack to 1 bit per cell (A=0, B=1). Hole cells get an arbitrary
// bit; the load path rebuilds the transparent sentinel from geometry.

function u8ToB64(u8: Uint8Array): string {
    let s = "";
    const chunk = 0x8000;
    for (let i = 0; i < u8.length; i += chunk) {
        s += String.fromCharCode(...u8.subarray(i, i + chunk));
    }
    return btoa(s);
}
function b64ToU8(s: string): Uint8Array {
    const bin = atob(s);
    const u8 = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
    return u8;
}

export function packPixels(pixels: Uint8Array): string {
    const out = new Uint8Array(Math.ceil(pixels.length / 8));
    for (let i = 0; i < pixels.length; i++) {
        if (pixels[i] === 2) out[i >> 3] |= 1 << (i & 7);
    }
    return u8ToB64(out);
}

export function packSelection(sel: Uint8Array): string {
    const out = new Uint8Array(Math.ceil(sel.length / 8));
    for (let i = 0; i < sel.length; i++) {
        if (sel[i]) out[i >> 3] |= 1 << (i & 7);
    }
    return u8ToB64(out);
}
export function unpackSelection(s: string, length: number): Uint8Array {
    const packed = b64ToU8(s);
    const out = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        out[i] = (packed[i >> 3] >> (i & 7)) & 1;
    }
    return out;
}

// Start from a fresh natural-colour pattern (which already encodes hole
// positions as 0) and overwrite non-hole cells with the saved A/B bit.
export function unpackPixels(s: string, state: PatternState): Uint8Array {
    const out = state.mode === "row"
        ? initialize_row_pattern(state.canvasWidth, state.canvasHeight)
        : initialize_round_pattern(
              state.canvasWidth, state.canvasHeight,
              state.virtualWidth, state.virtualHeight,
              state.offsetX, state.offsetY, state.rounds,
          );
    const packed = b64ToU8(s);
    for (let i = 0; i < out.length; i++) {
        if (out[i] !== 0) {
            out[i] = ((packed[i >> 3] >> (i & 7)) & 1) ? 2 : 1;
        }
    }
    return out;
}

export interface PackedFloat {
    mask:   string;
    pixels: string;
    dx:     number;
    dy:     number;
}
export function packFloat(f: { mask: Uint8Array; pixels: Uint8Array; dx: number; dy: number }): PackedFloat {
    return { mask: packSelection(f.mask), pixels: packPixels(f.pixels), dx: f.dx, dy: f.dy };
}
export function unpackFloat(p: PackedFloat, length: number): { mask: Uint8Array; pixels: Uint8Array; dx: number; dy: number } {
    const mask   = unpackSelection(p.mask, length);
    const packed = b64ToU8(p.pixels);
    const pixels = new Uint8Array(length);
    for (let i = 0; i < length; i++) {
        if (mask[i]) pixels[i] = ((packed[i >> 3] >> (i & 7)) & 1) ? 2 : 1;
    }
    return { mask, pixels, dx: p.dx, dy: p.dy };
}
