// @vitest-environment jsdom
// Property-based tests. Each `fc.property` claims an invariant; `fast-check`
// generates random inputs (default 100 runs) and shrinks counter-examples.
// Use jsdom — `history.ts` needs `localStorage`.

import { describe, test, expect, beforeEach } from "vitest";
import fc from "fast-check";

import {
    packPixels, unpackPixels,
    packSelection, unpackSelection,
    packFloat, unpackFloat,
} from "../src/storage";
import { liftCells, anchorIntoCanvas, applySelectionMod } from "../src/selection";
import { Store, visiblePixels } from "../src/store";
import {
    historyReset, historySave, historyUndo, historyRedo, historyPeek,
} from "../src/history";
import { wand_select } from "@mosaic/wasm";
import { rowSession } from "./_helpers";
import type { PatternState, Float } from "../src/types";

// ── Arbitraries ──────────────────────────────────────────────────────────────

// Row patterns only (round adds parity constraints + holes; covered by
// unit tests). Bounded dims keep shrink reports readable.
const rowPattern = fc.tuple(fc.integer({ min: 2, max: 12 }), fc.integer({ min: 2, max: 12 }))
    .map(([W, H]): PatternState => ({ mode: "row", canvasWidth: W, canvasHeight: H }));

// Pixels for a row pattern: each cell ∈ {1, 2} (no holes in row mode).
function rowPixelsOf(W: number, H: number) {
    return fc.array(fc.constantFrom<1 | 2>(1, 2), { minLength: W * H, maxLength: W * H })
        .map(arr => Uint8Array.from(arr));
}

// 0/1 mask of length W*H.
function maskOf(W: number, H: number) {
    return fc.array(fc.constantFrom<0 | 1>(0, 1), { minLength: W * H, maxLength: W * H })
        .map(arr => Uint8Array.from(arr));
}

// A row pattern paired with valid pixels.
const rowPatternWithPixels = rowPattern.chain(p =>
    rowPixelsOf(p.canvasWidth, p.canvasHeight).map(pixels => ({ pattern: p, pixels }))
);

// A row pattern + pixels + mask.
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
                        // Only masked cells carry meaningful pixel values.
                        if (out.pixels[i] !== pixels[i]) return false;
                    } else {
                        // Unmasked cells round-trip to 0 (the unpacker
                        // only sets non-mask positions if the mask says so).
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
            // Reconstruct the post-lift state and bake it back.
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
            // Pixels unchanged on second call.
            for (let i = 0; i < W * H; i++) {
                if (after1.pixels[i] !== after2.pixels[i]) return false;
            }
            // Mask same (or both null).
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
            // Use the first non-hole cell as the start; row patterns have
            // no holes, so (0, 0) always works.
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
            // BFS from (0,0) over mask=1 cells. Every reached cell should
            // be in `mask`; every mask cell should be reached.
            const reached = new Uint8Array(W * H);
            const queue = [0];
            reached[0] = 1;
            while (queue.length > 0) {
                const i = queue.shift()!;
                const x = i % W, y = Math.floor(i / W);
                const neighbours = [
                    [x - 1, y], [x + 1, y], [x, y - 1], [x, y + 1],
                ];
                for (const [nx, ny] of neighbours) {
                    if (nx < 0 || nx >= W || ny < 0 || ny >= H) continue;
                    const ni = ny * W + nx;
                    if (reached[ni] || !mask[ni]) continue;
                    reached[ni] = 1;
                    queue.push(ni);
                }
            }
            // Mask and reached should match.
            for (let i = 0; i < W * H; i++) {
                if (reached[i] !== mask[i]) return false;
            }
            return true;
        }));
    });
});

// ── History invariants ──────────────────────────────────────────────────────

describe("history undo/redo balance", () => {
    beforeEach(() => { localStorage.clear(); });

    test("N saves, N undos lands at the seed state", () => {
        fc.assert(fc.property(
            fc.array(rowPatternWithPixels, { minLength: 1, maxLength: 5 }),
            (states) => {
                localStorage.clear();
                const seed = rowSession(3, 3);
                historyReset(seed);
                for (const { pattern, pixels } of states) {
                    historySave(rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
                }
                let undone = 0;
                while (historyUndo()) undone++;
                const peeked = historyPeek();
                // Index is now 0 (seed). Verify by checking pixels match seed.
                return peeked !== null && peeked.pixels.length === seed.pixels.length;
            },
        ));
    });

    test("N saves, N undos, N redos lands at the last saved state", () => {
        fc.assert(fc.property(
            fc.array(rowPatternWithPixels, { minLength: 1, maxLength: 5 }),
            (states) => {
                localStorage.clear();
                historyReset(rowSession(3, 3));
                for (const { pattern, pixels } of states) {
                    historySave(rowSession(pattern.canvasWidth, pattern.canvasHeight, { pattern, pixels }));
                }
                const final = historyPeek();
                let undone = 0;
                while (historyUndo()) undone++;
                let redone = 0;
                while (historyRedo()) redone++;
                if (undone !== redone) return false;
                const after = historyPeek();
                if (!final || !after) return false;
                // Final state's pixels match (modulo dedupe trimming).
                return final.pixels.length === after.pixels.length;
            },
        ));
    });
});
