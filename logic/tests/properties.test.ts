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
import type { PatternState, Float } from "../src/types";

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

    test("packFloat/unpackFloat: mask + masked pixels + offset preserved", () => {
        fc.assert(fc.property(
            rowPatternWithPixelsAndMask,
            fc.integer({ min: -20, max: 20 }),
            fc.integer({ min: -20, max: 20 }),
            ({ pattern, pixels, mask }, dx, dy) => {
                const W = pattern.canvasWidth, H = pattern.canvasHeight;
                const f: Float = { mask, pixels, dx, dy };
                const out = unpackFloat(packFloat(f), W * H);
                if (out.dx !== dx || out.dy !== dy) return false;
                for (let i = 0; i < W * H; i++) {
                    if (out.mask[i] !== mask[i]) return false;
                    if (mask[i]) {
                        if (out.pixels[i] !== pixels[i]) return false;
                    } else {
                        if (out.pixels[i] !== 0) return false;
                    }
                }
                return true;
            },
        ));
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
            const after1 = {
                pixels: s1.state.pixels.slice(),
                mask:   s1.state.float ? s1.state.float.mask.slice() : null,
            };
            applySelectionMod(s1, mask, "add");
            const after2 = {
                pixels: s1.state.pixels.slice(),
                mask:   s1.state.float ? s1.state.float.mask.slice() : null,
            };
            for (let i = 0; i < W * H; i++) {
                if (after1.pixels[i] !== after2.pixels[i]) return false;
            }
            if ((after1.mask === null) !== (after2.mask === null)) return false;
            if (after1.mask && after2.mask) {
                for (let i = 0; i < W * H; i++) {
                    if (after1.mask[i] !== after2.mask[i]) return false;
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
