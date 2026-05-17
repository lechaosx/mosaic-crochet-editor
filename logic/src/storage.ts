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

// ── Float serialisation (current format) ─────────────────────────────────────
// Floats are stored bbox-compact: x/y/w/h integers + raw pixels base64.
// The pixels array is w×h bytes: 0=absent, 1=A, 2=B.

import { Float } from "./types";

export interface PackedFloat {
    x:      number;
    y:      number;
    w:      number;
    h:      number;
    pixels: string;   // base64 of raw w×h bytes (0/1/2)
}
export function packFloat(f: Float): PackedFloat {
    return { x: f.x, y: f.y, w: f.w, h: f.h, pixels: u8ToB64(f.pixels) };
}
export function unpackFloat(p: PackedFloat): Float {
    return { x: p.x, y: p.y, w: p.w, h: p.h, pixels: b64ToU8(p.pixels) };
}
