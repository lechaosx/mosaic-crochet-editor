// Property-based tests for pure logic invariants.
import { describe, test } from "vitest";
import fc from "fast-check";

import {
    packPixels, unpackPixels,
    packSelection, unpackSelection,
    packFloat, unpackFloat,
} from "../src/storage";
import { liftCells, anchorIntoCanvas, applySelectionMod } from "../src/selection";
import { Store, visiblePixels } from "../src/store";
import { wand_select } from "@mosaic/wasm";
import { rowSession } from "./_helpers";
import type { PatternState } from "../src/types";

// ── Arbitraries ──────────────────────────────────────────────────────────────

const rowPattern = fc.tuple(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 2, max: 12 }))
    .map(([W, H]): PatternState => ({ mode: "row", canvasWidth: W, canvasHeight: H }));

function rowPixelsOf(W: number, H: number) {
    return fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: W * H, maxLength: W * H })
        .map(arr => Uint8Array.from(arr));
}

function maskOf(W: number, H: number) {
    return fc.array(fc.constantFrom<0 | 1>(0, 1), { minLength: W * H, maxLength: W * H })
        .map(arr => Uint8Array.from(arr));
}

const rowPatternWithPixels = rowPattern.chain(p =>
    rowPixelsOf(p.canvasWidth, p.canvasHeight).map(pixels => ({ pattern: p, pixels }))
);

const rowPatternWithPixelsAndMask = rowPatternWithPixels.chain(({ pattern, pixels }) =>
    maskOf(pattern.canvasWidth, pattern.canvasHeight).map(mask => ({ pattern, pixels, mask }))
);

// ── Round-trips ──────────────────────────────────────────────────────────────

describe("pack/unpack round-trips", () => {
    test("packPixels/unpackPixels: row-mode pixels preserved", () => {
        fc.assert(fc.property(rowPatternWithPixels, ({ pattern, pixels }) => {
            const out = unpackPixels(packPixels(pixels), pattern);
            for (let i = 0; i < pixels.length; i++) {
                if (out[i] !== pixels[i]) return false;
            }
            return true;
        }));
    });

    test("packSelection/unpackSelection: bitmask preserved", () => {
        const arb = fc.integer({ min: 1, max: 200 })
            .chain(n => fc.array(fc.constantFrom<0 | 1>(0, 1), { minLength: n, maxLength: n })
                .map(arr => Uint8Array.from(arr)));
        fc.assert(fc.property(arb, (bits) => {
            const out = unpackSelection(packSelection(bits), bits.length);
            for (let i = 0; i < bits.length; i++) if (out[i] !== bits[i]) return false;
            return true;
        }));
    });

    test("packFloat/unpackFloat: x/y/w/h/pixels preserved", () => {
        const arbFloat = fc.tuple(
            fc.integer({ min: -20, max: 20 }),   // x
            fc.integer({ min: -20, max: 20 }),   // y
            fc.integer({ min: 1,   max: 15  }),  // w
            fc.integer({ min: 1,   max: 15  }),  // h
        ).chain(([x, y, w, h]) =>
            fc.array(fc.constantFrom<0 | 1 | 2>(0, 1, 2), { minLength: w * h, maxLength: w * h })
              .map(arr => ({ x, y, w, h, pixels: Uint8Array.from(arr) }))
        );
        fc.assert(fc.property(arbFloat, f => {
            const out = unpackFloat(packFloat(f));
            if (out.x !== f.x || out.y !== f.y || out.w !== f.w || out.h !== f.h) return false;
            for (let i = 0; i < f.pixels.length; i++) {
                if (out.pixels[i] !== f.pixels[i]) return false;
            }
            return true;
        }));
    });
});

// ── Selection invariants ─────────────────────────────────────────────────────

describe("lift / anchor", () => {
    test("lift then anchor is the identity on row pixels", () => {
        fc.assert(fc.property(rowPatternWithPixelsAndMask, ({ pattern, pixels, mask }) => {
            const lifted = liftCells(pixels, pattern, mask);
            const s = rowSession(pattern.canvasWidth, pattern.canvasHeight, {
                pattern, pixels: lifted.pixels, float: lifted.float,
            });
            const baked = anchorIntoCanvas(s);
            for (let i = 0; i < pixels.length; i++) {
                if (baked.pixels[i] !== pixels[i]) return false;
            }
            return true;
        }));
    });

    test("applySelectionMod add is idempotent (apply twice = apply once)", () => {
        fc.assert(fc.property(rowPatternWithPixelsAndMask, ({ pattern, pixels, mask }) => {
            const W = pattern.canvasWidth, H = pattern.canvasHeight;
            const s1 = new Store(rowSession(W, H, { pattern, pixels }));
            applySelectionMod(s1, mask, "add");
            // Capture present-cell set after first add.
            const after1Pixels = s1.state.pixels.slice();
            const f1 = s1.state.float;
            const after1Float = f1 ? { x: f1.x, y: f1.y, w: f1.w, h: f1.h, pixels: f1.pixels.slice() } : null;

            applySelectionMod(s1, mask, "add");
            const after2Pixels = s1.state.pixels.slice();
            const f2 = s1.state.float;
            const after2Float = f2 ? { x: f2.x, y: f2.y, w: f2.w, h: f2.h, pixels: f2.pixels.slice() } : null;

            for (let i = 0; i < W * H; i++) {
                if (after1Pixels[i] !== after2Pixels[i]) return false;
            }
            if ((after1Float === null) !== (after2Float === null)) return false;
            if (after1Float && after2Float) {
                // Compare present cells in canvas space.
                for (let y = 0; y < H; y++) {
                    for (let x = 0; x < W; x++) {
                        const in1 = (() => {
                            const lx = x - after1Float.x, ly = y - after1Float.y;
                            if (lx < 0 || lx >= after1Float.w || ly < 0 || ly >= after1Float.h) return 0;
                            return after1Float.pixels[ly * after1Float.w + lx];
                        })();
                        const in2 = (() => {
                            const lx = x - after2Float.x, ly = y - after2Float.y;
                            if (lx < 0 || lx >= after2Float.w || ly < 0 || ly >= after2Float.h) return 0;
                            return after2Float.pixels[ly * after2Float.w + lx];
                        })();
                        if (in1 !== in2) return false;
                    }
                }
            }
            return true;
        }));
    });
});

// ── Wand BFS invariant ───────────────────────────────────────────────────────

describe("wand_select", () => {
    test("every cell in the returned mask matches the start cell's colour", () => {
        fc.assert(fc.property(rowPatternWithPixels, ({ pattern, pixels }) => {
            const W = pattern.canvasWidth, H = pattern.canvasHeight;
            const startColor = pixels[0];
            const mask = wand_select(pixels, W, H, 0, 0, 0, new Uint8Array(0));
            for (let i = 0; i < W * H; i++) {
                if (mask[i] && pixels[i] !== startColor) return false;
            }
            return true;
        }));
    });

    test("returned mask is 4-connected starting from the click cell", () => {
        fc.assert(fc.property(rowPatternWithPixels, ({ pattern, pixels }) => {
            const W = pattern.canvasWidth, H = pattern.canvasHeight;
            const mask = wand_select(pixels, W, H, 0, 0, 0, new Uint8Array(0));
            const reached = new Uint8Array(W * H);
            const queue = [0];
            reached[0] = 1;
            while (queue.length > 0) {
                const i = queue.shift()!;
                const x = i % W, y = Math.floor(i / W);
                for (const [nx, ny] of [[x-1,y],[x+1,y],[x,y-1],[x,y+1]]) {
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const ni = ny * W + nx;
                    if (reached[ni] || !mask[ni]) continue;
                    reached[ni] = 1;
                    queue.push(ni);
                }
            }
            for (let i = 0; i < W * H; i++) {
                if (reached[i] !== mask[i]) return false;
            }
            return true;
        }));
    });
});
