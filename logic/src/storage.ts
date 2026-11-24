import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import { PatternState } from "./types";

// In-memory pixel encoding: 0 = inner hole, 1 = COLOR_A, 2 = COLOR_B.
// On disk we pack to 1 bit per cell (A=0, B=1). Hole cells get an arbitrary
// bit; the load path rebuilds the transparent sentinel from geometry.

// Byte-wise because undo snapshots and browser recovery pack whole charts of
// up to millions of cells on every commit. `p >> 1` maps A/hole to 0, B to 1.
export function packPixels(p: Uint8Array): string {
    const out = new Uint8Array(Math.ceil(p.length / 8));
    const full = p.length >> 3;
    for (let b = 0, i = 0; b < full; b++, i += 8) {
        out[b] = (p[i] >> 1) | (p[i + 1] >> 1) << 1 | (p[i + 2] >> 1) << 2 | (p[i + 3] >> 1) << 3
            | (p[i + 4] >> 1) << 4 | (p[i + 5] >> 1) << 5 | (p[i + 6] >> 1) << 6 | (p[i + 7] >> 1) << 7;
    }
    for (let i = full * 8; i < p.length; i++) {
        if (p[i] === 2) out[i >> 3] |= 1 << (i & 7);
    }
    return out.toBase64();
}

// CELLS[2v], CELLS[2v + 1]: packed byte v expanded to eight cells (1 or 2) as
// two little-endian words, so they land in cell order through a Uint32Array
// view on little-endian hosts (every browser platform).
const CELLS = new Uint32Array(512);
for (let v = 0; v < 256; v++) {
    for (let k = 0; k < 8; k++) CELLS[2 * v + (k >> 2)] |= ((v >> k) & 1 ? 2 : 1) << 8 * (k & 3);
}

// Start from a fresh natural-colour pattern (which already encodes hole
// positions as 0) and overwrite non-hole cells with the saved A/B bit.
// `layout`, pixels of the same geometry, spares building that pattern: its
// cells are 0 at the same holes.
export function unpackPixels(s: string, state: PatternState, layout?: Uint8Array): Uint8Array {
    const out = layout ? layout.slice() : state.mode === "row"
        ? initialize_row_pattern(state.canvasWidth, state.canvasHeight)
        : initialize_round_pattern(
              state.canvasWidth, state.canvasHeight,
              state.virtualWidth, state.virtualHeight,
              state.offsetX, state.offsetY, state.rounds,
          );
    const packed = Uint8Array.fromBase64(s);
    if (packed.length !== Math.ceil(out.length / 8)) {
        throw new RangeError("Packed pixel data has the wrong length.");
    }
    // Eight cells per step. Cell bytes are 0, 1 or 2, so (w | w >>> 1) has bit
    // 0 of each byte set exactly for non-hole cells; times 0xff that becomes a
    // byte mask that keeps holes 0.
    const full = out.length >> 3;
    const words = new Uint32Array(out.buffer, out.byteOffset, full * 2);
    for (let b = 0; b < full; b++) {
        const v = packed[b], lo = words[2 * b], hi = words[2 * b + 1];
        words[2 * b]     = CELLS[2 * v]     & ((lo | lo >>> 1) & 0x01010101) * 0xff;
        words[2 * b + 1] = CELLS[2 * v + 1] & ((hi | hi >>> 1) & 0x01010101) * 0xff;
    }
    for (let i = full * 8; i < out.length; i++) {
        if (out[i] !== 0) {
            out[i] = ((packed[i >> 3] >> (i & 7)) & 1) ? 2 : 1;
        }
    }
    return out;
}

// A whole-cell mask packed to one bit per cell, least significant first.
export function packMask(mask: Uint8Array): string {
    const packed = new Uint8Array(Math.ceil(mask.length / 8));
    for (let i = 0; i < mask.length; i++) {
        if (mask[i] !== 0) packed[i >> 3] |= 1 << (i & 7);
    }
    return packed.toBase64();
}

export function unpackMask(source: string, length: number): Uint8Array {
    const bytes = Uint8Array.fromBase64(source);
    if (bytes.length !== Math.ceil(length / 8)) throw new RangeError("Packed mask data has the wrong length.");
    const mask = new Uint8Array(length);
    for (let i = 0; i < length; i++) mask[i] = (bytes[i >> 3] >> (i & 7)) & 1;
    return mask;
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
    return { x: f.x, y: f.y, w: f.w, h: f.h, pixels: f.pixels.toBase64() };
}
export function unpackFloat(p: PackedFloat): Float {
    return { x: p.x, y: p.y, w: p.w, h: p.h, pixels: Uint8Array.fromBase64(p.pixels) };
}
