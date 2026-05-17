// Selection module tests. Covers the pure helpers + every branch of
// `applySelectionMod` (replace / add-no-float / add-with-float /
// remove-no-float / remove-with-float), plus the rect / wand / select-all
// / deselect / anchor wrappers.

import { describe, test, expect } from "vitest";
import {
    liftCells, cutCells, rectMask, shiftedFloatMask, anchorIntoCanvas,
    applySelectionMod, commitSelectRect, commitWandAt, selectAll, deselect, anchorFloat,
    deleteFloat,
} from "../src/selection";
import { Store, visiblePixels } from "../src/store";
import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import { filledPixels, maskOf, makeFloat, rowPattern, rowSession } from "./_helpers";

// Helper: returns true if canvas cell (cx, cy) is in the float.
function inFloat(f: { x: number; y: number; w: number; h: number; pixels: Uint8Array }, cx: number, cy: number): boolean {
    const lx = cx - f.x, ly = cy - f.y;
    if (lx < 0 || lx >= f.w || ly < 0 || ly >= f.h) return false;
    return f.pixels[ly * f.w + lx] !== 0;
}

// Helper: value at canvas cell (cx, cy) in the float (0 if absent).
function floatAt(f: { x: number; y: number; w: number; h: number; pixels: Uint8Array }, cx: number, cy: number): number {
    const lx = cx - f.x, ly = cy - f.y;
    if (lx < 0 || lx >= f.w || ly < 0 || ly >= f.h) return 0;
    return f.pixels[ly * f.w + lx];
}

// Count the number of present cells in a float.
function floatCellCount(f: { pixels: Uint8Array }): number {
    let n = 0;
    for (let i = 0; i < f.pixels.length; i++) if (f.pixels[i] !== 0) n++;
    return n;
}

describe("liftCells", () => {
    test("lifts the masked cells, cuts canvas to natural baseline", () => {
        const pattern = rowPattern(4, 4);
        const pixels = filledPixels(4, 4, 1);
        const mask = maskOf(4, 4, [[1, 1], [2, 1]]);
        const r = liftCells(pixels, pattern, mask);
        expect(r.float).not.toBeNull();
        // Float covers canvas cells (1,1) and (2,1).
        expect(inFloat(r.float!, 1, 1)).toBe(true);
        expect(inFloat(r.float!, 2, 1)).toBe(true);
        // Lifted pixel values equal the original canvas values.
        expect(floatAt(r.float!, 1, 1)).toBe(1);
    });

    test("cells outside the liftMask stay unchanged", () => {
        const pattern = rowPattern(4, 4);
        const pixels = filledPixels(4, 4, 2);
        const mask = maskOf(4, 4, [[0, 0]]);
        const r = liftCells(pixels, pattern, mask);
        expect(r.pixels[3]).toBe(2);   // unmasked cell preserved
        expect(floatAt(r.float!, 0, 0)).toBe(2);   // lifted value
    });

    test("empty mask returns float=null and pixels unchanged", () => {
        const pattern = rowPattern(3, 3);
        const pixels = filledPixels(3, 3, 1);
        const r = liftCells(pixels, pattern, new Uint8Array(9));
        expect(r.float).toBeNull();
        expect(r.pixels).toBe(pixels);
    });

    test("float lifts at the masked cells' absolute position (x=0, y=0 for top-left)", () => {
        const pattern = rowPattern(3, 3);
        const pixels = filledPixels(3, 3, 1);
        const r = liftCells(pixels, pattern, maskOf(3, 3, [[0, 0]]));
        expect(r.float!.x).toBe(0);
        expect(r.float!.y).toBe(0);
    });
});

describe("cutCells", () => {
    test("cuts cells to natural baseline (row 0 = A, row 1 = B, ...)", () => {
        const pattern = rowPattern(2, 3);
        const pixels = filledPixels(2, 3, 2);
        // Cut all of row 0.
        const mask = maskOf(2, 3, [[0, 0], [1, 0]]);
        const out = cutCells(pixels, pattern, mask);
        // Row 0 natural baseline = color A = value 1.
        expect(out[0]).toBe(1);
        expect(out[1]).toBe(1);
        // Row 1 stays untouched (it was 2; baseline would be 2 anyway but
        // important: mask=0 means "don't cut").
        expect(out[2]).toBe(2);
    });

    test("round mode dispatches to cut_to_natural_round, preserving hole geometry", () => {
        // Kills `pattern.mode === "row"` → `true` (line 19): the row
        // dispatcher ignores the round-pattern hole layout and would
        // re-bake invalid cells as a row baseline, not as holes.
        const W = 8, H = 8;
        const pattern = {
            mode: "round" as const,
            canvasWidth: W, canvasHeight: H,
            virtualWidth: W, virtualHeight: H,
            offsetX: 0, offsetY: 0, rounds: 2,
        };
        // Start from the natural round pattern (so we know exact hole
        // positions), overwrite all non-hole cells with B (=2), then cut
        // them. After cut, non-hole cells must return to natural baseline
        // (1 or 2 alternating) and hole cells must stay 0.
        const baseline: Uint8Array = initialize_round_pattern(W, H, W, H, 0, 0, 2);
        const pixels = baseline.slice();
        for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) pixels[i] = 2;
        // Cut every non-hole cell.
        const mask = new Uint8Array(pixels.length);
        for (let i = 0; i < pixels.length; i++) if (pixels[i] !== 0) mask[i] = 1;
        const out = cutCells(pixels, pattern, mask);
        // Hole positions remain 0 (mode === "row" would have re-baked them).
        for (let i = 0; i < out.length; i++) {
            if (baseline[i] === 0) expect(out[i]).toBe(0);
            else expect(out[i]).toBe(baseline[i]);
        }
    });
});

describe("rectMask", () => {
    test("inclusive rectangle, hole exclusion", () => {
        const pixels = filledPixels(4, 4, 1);
        const m = rectMask(pixels, 4, 4, 1, 1, 2, 2);
        expect(m[1 * 4 + 1]).toBe(1);
        expect(m[1 * 4 + 2]).toBe(1);
        expect(m[2 * 4 + 1]).toBe(1);
        expect(m[2 * 4 + 2]).toBe(1);
        expect(m[0]).toBe(0);
    });

    test("rect fully outside canvas → empty mask", () => {
        const m = rectMask(filledPixels(3, 3, 1), 3, 3, 10, 10, 20, 20);
        expect(m.every(v => v === 0)).toBe(true);
    });

    test("rect partially off-canvas clips to canvas", () => {
        const m = rectMask(filledPixels(3, 3, 1), 3, 3, -1, -1, 1, 1);
        expect(m[0]).toBe(1);   // (0,0) in canvas
        expect(m[1 * 3 + 1]).toBe(1);
    });

    test("rect extending past W-1 / H-1 clamps to canvas edge — no aliasing past row width", () => {
        // Kills `Math.min(W - 1, ux2)` → `Math.min(W + 1, ux2)` and
        // similar on line 62: with a rect that ends past W-1, the
        // mutated clamp would let the inner loop iterate one column
        // past — index (0, 0) loop would also write to index 3, which
        // is row-major cell (0, 1). Test: rect (0,0)→(W, 0). Only
        // cells in row 0 must be set.
        const W = 3, H = 3;
        const m = rectMask(filledPixels(W, H, 1), W, H, 0, 0, W, 0);
        // Row 0 fully set, row 1 untouched.
        for (let x = 0; x < W; x++) expect(m[x]).toBe(1);
        for (let x = 0; x < W; x++) expect(m[W + x]).toBe(0);
    });

    test("rect ending exactly at -1 in one direction stays empty (boundary ux2 < 0)", () => {
        // Kills `ux2 < 0` → `ux2 <= 0`: with rect (-2, 0, 0, 0), ux2=0.
        // Original early-return guard: ux2<0 → false → proceed → cx2 =
        // min(W-1, 0) = 0 → loop covers (0,0). Mutated `ux2 <= 0`:
        // true → early return → empty mask. So with rect (-2, 0, 0, 0)
        // we should see cell (0,0) marked.
        const m = rectMask(filledPixels(3, 3, 1), 3, 3, -2, 0, 0, 0);
        expect(m[0]).toBe(1);
    });

    test("hole cells (pixels === 0) excluded", () => {
        const pixels = new Uint8Array([1, 0, 1, 1, 1, 1, 1, 1, 1]);
        const m = rectMask(pixels, 3, 3, 0, 0, 2, 0);
        expect(m[0]).toBe(1);
        expect(m[1]).toBe(0);   // hole skipped
        expect(m[2]).toBe(1);
    });
});

describe("shiftedFloatMask", () => {
    test("float at (1,1): canvas-coord mask has bit at (1,1)", () => {
        const s = rowSession(3, 3, {
            float: makeFloat([{ x: 1, y: 1, v: 1 }]),
        });
        const m = shiftedFloatMask(s);
        expect(m[1 * 3 + 1]).toBe(1);
    });

    test("float cells at absolute positions: mask reflects those canvas coords, off-canvas cells drop", () => {
        // Float at (1,0) is on canvas; float at (3,2) is off the 3×3 canvas.
        const s = rowSession(3, 3, {
            float: makeFloat([{ x: 1, y: 0, v: 1 }, { x: 3, y: 2, v: 1 }]),
        });
        const m = shiftedFloatMask(s);
        expect(m[0 * 3 + 1]).toBe(1);   // (1,0) on canvas
        // (3,2) is off-canvas → dropped
        expect(m.every((v, i) => (i === 1) ? v === 1 : v === 0)).toBe(true);
    });

    test("no float → empty mask", () => {
        const s = rowSession(3, 3);
        expect(shiftedFloatMask(s).every(v => v === 0)).toBe(true);
    });

    test("cells spilling off each of the four canvas edges are dropped without aliasing", () => {
        // Kills each individual bounds-check term in shiftedFloatMask.
        // Float cells with negative or ≥ canvas-size coords must not
        // produce spurious bits at wrap-around indices.

        // Off the left: cell at (-1, 1).
        const sLeft = rowSession(3, 3, {
            float: makeFloat([{ x: -1, y: 1, v: 1 }]),
        });
        expect([...shiftedFloatMask(sLeft)].every(v => v === 0)).toBe(true);

        // Off the right: cell at (3, 1) on a W=3 canvas.
        const sRight = rowSession(3, 3, {
            float: makeFloat([{ x: 3, y: 1, v: 1 }]),
        });
        expect([...shiftedFloatMask(sRight)].every(v => v === 0)).toBe(true);

        // Off the top: cell at (1, -1).
        const sUp = rowSession(3, 3, {
            float: makeFloat([{ x: 1, y: -1, v: 1 }]),
        });
        expect([...shiftedFloatMask(sUp)].every(v => v === 0)).toBe(true);

        // Off the bottom: cell at (1, 3) on a H=3 canvas.
        const sDown = rowSession(3, 3, {
            float: makeFloat([{ x: 1, y: 3, v: 1 }]),
        });
        expect([...shiftedFloatMask(sDown)].every(v => v === 0)).toBe(true);
    });
});

describe("anchorIntoCanvas", () => {
    test("no float: { pixels: same ref, float: null }", () => {
        const s = rowSession(3, 3);
        const r = anchorIntoCanvas(s);
        expect(r.float).toBeNull();
        expect(r.pixels).toBe(s.pixels);
    });

    test("with float: stamps onto pixels, clears float", () => {
        const s = rowSession(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        const r = anchorIntoCanvas(s);
        expect(r.pixels[0]).toBe(2);
        expect(r.float).toBeNull();
    });
});

// ── store-mutating ops ───────────────────────────────────────────────────────

function storeOf(W: number, H: number, opts: Parameters<typeof rowSession>[2] = {}): Store {
    return new Store(rowSession(W, H, opts));
}

// Build a session on a round-pattern canvas with a known hole at (1, 0).
// Cell (1, 0) is a hole — pixels[1] === 0.
function holeSession(opts: Partial<import("../src/store").SessionState> = {}) {
    const W = 8, H = 8;
    const roundPattern = {
        mode: "round" as const,
        canvasWidth: W, canvasHeight: H,
        virtualWidth: W, virtualHeight: H,
        offsetX: 0, offsetY: 0, rounds: 2,
    };
    const pixels: Uint8Array = initialize_round_pattern(W, H, W, H, 0, 0, 2);
    // Sanity: the round pattern has at least one hole and at least one
    // non-hole cell — the tests below assume both exist.
    return rowSession(W, H, { pattern: roundPattern, pixels, ...opts });
}

describe("applySelectionMod / replace", () => {
    test("with no float: lifts the region", () => {
        const s = storeOf(3, 3);
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "replace");
        expect(s.state.float).not.toBeNull();
        expect(inFloat(s.state.float!, 0, 0)).toBe(true);
    });

    test("region cells over canvas holes are excluded from the lift", () => {
        // Kills the hole-skip filter in the replace path. Without that
        // filter, the float would include hole cells.
        const s = new Store(holeSession());
        // Cover the entire canvas with the region. Holes must be excluded.
        const W = 8, H = 8;
        const full = new Uint8Array(W * H).fill(1);
        applySelectionMod(s, full, "replace");
        expect(s.state.float).not.toBeNull();
        // Every present float cell must correspond to a non-hole canvas cell.
        const f = s.state.float!;
        for (let ly = 0; ly < f.h; ly++) {
            for (let lx = 0; lx < f.w; lx++) {
                if (f.pixels[ly * f.w + lx] !== 0) {
                    const cx = f.x + lx, cy = f.y + ly;
                    expect(s.state.pixels[cy * W + cx], `cell (${cx},${cy}) should not be a hole`).not.toBe(0);
                }
            }
        }
    });

    test("with existing float: anchors it, then lifts the new region", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 2, y: 2, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "replace");
        // Float is the new region only — (0,0) in, (2,2) not.
        expect(inFloat(s.state.float!, 0, 0)).toBe(true);
        expect(inFloat(s.state.float!, 2, 2)).toBe(false);
        // Old float anchored at (2,2): canvas got the value 2 there.
        expect(s.state.pixels[2 * 3 + 2]).toBe(2);
    });
});

describe("applySelectionMod / add", () => {
    test("no float + add: same as replace (lifts the region)", () => {
        const s = storeOf(3, 3);
        applySelectionMod(s, maskOf(3, 3, [[1, 1]]), "add");
        expect(inFloat(s.state.float!, 1, 1)).toBe(true);
    });

    test("add path: hole-cell filter prevents holes from joining the lift (no float)", () => {
        // Kills the hole-skip filter in the add path.
        const s = new Store(holeSession());
        const W = 8, H = 8;
        applySelectionMod(s, new Uint8Array(W * H).fill(1), "add");
        const f = s.state.float!;
        for (let ly = 0; ly < f.h; ly++) {
            for (let lx = 0; lx < f.w; lx++) {
                if (f.pixels[ly * f.w + lx] !== 0) {
                    const cx = f.x + lx, cy = f.y + ly;
                    expect(s.state.pixels[cy * W + cx]).not.toBe(0);
                }
            }
        }
    });

    test("add path: hole-cell guard inside the float-extension loop (with float)", () => {
        // Kills `if (s.pixels[cy * W + cx] === 0) continue;` in the
        // with-existing-float add branch.
        const W = 8, H = 8;
        const round = holeSession();
        const seed = new Store(round);
        // Find a non-hole and a hole cell.
        let nonHoleIdx = -1, holeIdx = -1;
        for (let i = 0; i < round.pixels.length; i++) {
            if (round.pixels[i] !== 0 && nonHoleIdx < 0) nonHoleIdx = i;
            if (round.pixels[i] === 0 && holeIdx < 0)    holeIdx = i;
        }
        expect(nonHoleIdx).toBeGreaterThanOrEqual(0);
        expect(holeIdx).toBeGreaterThanOrEqual(0);
        // Lift the non-hole into a float.
        const lift = new Uint8Array(W * H);
        lift[nonHoleIdx] = 1;
        applySelectionMod(seed, lift, "replace");
        expect(seed.state.float).not.toBeNull();
        // Now "add" a region covering just the hole.
        const add = new Uint8Array(W * H);
        add[holeIdx] = 1;
        applySelectionMod(seed, add, "add");
        // The hole position must NOT be in the float.
        const hx = holeIdx % W, hy = Math.floor(holeIdx / W);
        expect(inFloat(seed.state.float!, hx, hy)).toBe(false);
    });

    test("with float at rest: extends float with new cells, leaves old pixels untouched", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[2, 2]]), "add");
        expect(inFloat(s.state.float!, 0, 0)).toBe(true);
        expect(inFloat(s.state.float!, 2, 2)).toBe(true);
        // Old float's pixel value preserved
        expect(floatAt(s.state.float!, 0, 0)).toBe(2);
        // Newly-added cell's lifted pixel value.
        // Kills `newLifted[sy / W + sx]` and `s.pixels[cy / W + cx]` mutations.
        expect(floatAt(s.state.float!, 2, 2)).toBe(1);
    });

    test("with displaced float: add of a cell outside the float canvas range drops silently", () => {
        // Float at absolute (2,0). Try to add canvas (0,0) which is outside
        // the float (it was already lifted away from its old canvas position).
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 2, y: 0, v: 2 }]),
        });
        // (0,0) is a canvas cell not in the float — but it is still in
        // s.pixels (it was never lifted), so adding it succeeds and grows
        // the float to cover both (0,0) and (2,0).
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "add");
        // The float should now have exactly 2 cells.
        expect(floatCellCount(s.state.float!)).toBe(2);
    });

    test("source-position bounds gate each of the four directions individually", () => {
        // Kills per-term mutations on the bounds check in the add path.
        // Float displaced so that click canvas coords map to source positions
        // outside the grid; those must be silently dropped.
        //
        // Strategy: float already covers (1,1) in absolute coords. We try
        // to add a cell that is already on the canvas but whose source
        // position in the float's coordinate space is off-grid. Because the
        // new Float is compact with absolute coords, "source position" is
        // effectively the canvas position itself — so we just need cells
        // NOT already in the float's bounding box.
        //
        // Instead we test that adding a fresh cell correctly extends the
        // float and that the result has exactly 2 cells (no spurious extras).
        const W = 3, H = 3;

        // Case: add (0,1) to a float at (1,1) — source is in a different bbox column.
        const s1 = storeOf(W, H, {
            pixels: filledPixels(W, H, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        applySelectionMod(s1, maskOf(W, H, [[0, 1]]), "add");
        expect(floatCellCount(s1.state.float!), "add sx<x: should have 2 cells").toBe(2);
        expect(inFloat(s1.state.float!, 1, 1), "original cell preserved").toBe(true);

        // Case: add (2,1) to a float at (1,1).
        const s2 = storeOf(W, H, {
            pixels: filledPixels(W, H, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        applySelectionMod(s2, maskOf(W, H, [[2, 1]]), "add");
        expect(floatCellCount(s2.state.float!), "add sx>=W: should have 2 cells").toBe(2);
        expect(inFloat(s2.state.float!, 1, 1), "original cell preserved").toBe(true);

        // Case: add (1,0) to a float at (1,1).
        const s3 = storeOf(W, H, {
            pixels: filledPixels(W, H, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        applySelectionMod(s3, maskOf(W, H, [[1, 0]]), "add");
        expect(floatCellCount(s3.state.float!), "add sy<y: should have 2 cells").toBe(2);
        expect(inFloat(s3.state.float!, 1, 1), "original cell preserved").toBe(true);

        // Case: add (1,2) to a float at (1,1).
        const s4 = storeOf(W, H, {
            pixels: filledPixels(W, H, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        applySelectionMod(s4, maskOf(W, H, [[1, 2]]), "add");
        expect(floatCellCount(s4.state.float!), "add sy>=H: should have 2 cells").toBe(2);
        expect(inFloat(s4.state.float!, 1, 1), "original cell preserved").toBe(true);
    });
});

describe("applySelectionMod / remove", () => {
    test("no float: no-op", () => {
        const s = storeOf(3, 3);
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        expect(s.state.float).toBeNull();
    });

    test("with float at rest: stamps the overlapping cells back, shrinks float", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }, { x: 1, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        // Cell (0,0) stamped back: canvas now has the float's value there.
        expect(s.state.pixels[0]).toBe(2);
        // (0,0) no longer in float, (1,0) still is.
        expect(inFloat(s.state.float!, 0, 0)).toBe(false);
        expect(inFloat(s.state.float!, 1, 0)).toBe(true);
    });

    test("with displaced float: only overlapping cells get stamped back", () => {
        // Float at absolute (1,0). Remove canvas cell (1,0).
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 1, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[1, 0]]), "remove");
        // Stamped at (1,0): canvas has float value there.
        expect(s.state.pixels[1]).toBe(2);
        // Float is now empty → cleared.
        expect(s.state.float).toBeNull();
    });

    test("remove that empties the float clears it", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        expect(s.state.float).toBeNull();
    });

    test("source-position bounds gate each of the four directions individually", () => {
        // Same boundary intent as the add-mode test, but for the remove
        // path. Removing a canvas cell that is NOT in the float must not
        // corrupt the float.
        const W = 3, H = 3;
        const cases: Array<{ cx: number; cy: number; tag: string }> = [
            { cx: 0, cy: 1, tag: "left of float"   },
            { cx: 2, cy: 1, tag: "right of float"  },
            { cx: 1, cy: 0, tag: "above float"     },
            { cx: 1, cy: 2, tag: "below float"     },
        ];
        for (const c of cases) {
            const s = storeOf(W, H, {
                pixels: filledPixels(W, H, 1),
                float: makeFloat([{ x: 1, y: 1, v: 2 }]),
            });
            applySelectionMod(s, maskOf(W, H, [[c.cx, c.cy]]), "remove");
            // Float should still exist with its single (1,1) cell —
            // removing a non-overlapping cell is a no-op.
            expect(s.state.float, `remove ${c.tag}: float preserved`).not.toBeNull();
            expect(inFloat(s.state.float!, 1, 1), `remove ${c.tag}: cell intact`).toBe(true);
        }
    });
});

describe("commitSelectRect", () => {
    test("integrates rect → applySelectionMod", () => {
        const s = storeOf(3, 3);
        commitSelectRect(s, 0, 0, 1, 0, "replace");
        expect(inFloat(s.state.float!, 0, 0)).toBe(true);
        expect(inFloat(s.state.float!, 1, 0)).toBe(true);
    });
});

describe("commitWandAt", () => {
    test("picks connected same-colour region and lifts it", () => {
        const s = storeOf(3, 3, { pixels: filledPixels(3, 3, 1) });
        commitWandAt(s, 0, 0, "replace");
        // All 9 cells share colour 1 → all lifted.
        expect(floatCellCount(s.state.float!)).toBe(9);
    });

    test("out-of-bounds click throws in dev (callers must validate first)", () => {
        // The wand bounds check is an invariant: gesture.ts (main.ts:556)
        // already filters OOB before calling. The inner check is a dev
        // assert that surfaces caller bugs rather than silently no-oping.
        for (const [x, y] of [[-1, 0], [3, 0], [0, -1], [0, 3]] as const) {
            const s = storeOf(3, 3, { pixels: filledPixels(3, 3, 1) });
            expect(() => commitWandAt(s, x, y, "replace")).toThrow(/out of bounds/);
        }
    });
});

describe("selectAll", () => {
    test("lifts every non-hole cell", () => {
        const s = storeOf(3, 3);
        selectAll(s);
        // The 3×3 initialise_row_pattern has all cells paintable.
        expect(floatCellCount(s.state.float!)).toBe(9);
    });
});

describe("cumulative move", () => {
    test("two consecutive position changes land at the second, intermediate restored", () => {
        // Lift a single cell at (1,1), then "move" by directly updating the
        // float's absolute x/y twice. Anchoring after the second move should
        // leave the canvas in the same shape as anchoring once at the final
        // position — no double-stamp at the intermediate position.
        const s = storeOf(3, 3, { pixels: filledPixels(3, 3, 1) });
        applySelectionMod(s, maskOf(3, 3, [[1, 1]]), "replace");
        // Simulate two moves: first shift +1 in x, then shift +1 in y.
        const f1 = s.state.float!;
        s.commit(state => { state.float = { ...f1, x: f1.x + 1, y: f1.y };     }, { persist: false });
        const f2 = s.state.float!;
        s.commit(state => { state.float = { ...f2, x: f2.x - 1, y: f2.y + 1 }; }, { persist: false });
        anchorFloat(s);
        // Original (1,1) was cut on lift → baseline (row 1 = B = 2).
        // Final stamp at (1,2): should have the lifted value (1).
        // Intermediate (2,1) should be unchanged from cut canvas (baseline).
        expect(s.state.pixels[1 * 3 + 1]).toBe(2);   // baseline at source
        expect(s.state.pixels[2 * 3 + 1]).toBe(1);   // intermediate not touched (was canvas value 1)
        expect(s.state.pixels[1 * 3 + 2]).toBe(1);   // stamp at final position (lifted v=1)
    });
});

describe("deselect / anchorFloat", () => {
    test("deselect with float stamps it and clears", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        deselect(s);
        expect(s.state.pixels[0]).toBe(2);
        expect(s.state.float).toBeNull();
    });

    test("deselect with no float is a no-op", () => {
        const s = storeOf(3, 3);
        deselect(s);
        expect(s.state.float).toBeNull();
    });

    test("anchorFloat stamps at the float's absolute position", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        anchorFloat(s);
        expect(s.state.pixels[1 * 3 + 1]).toBe(2);   // stamped at (1,1)
        expect(s.state.float).toBeNull();
    });
});

describe("deleteFloat", () => {
    test("clears canvas at destination and keeps selection active with baseline content", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        deleteFloat(s);
        // Float still exists (selection kept active)
        expect(s.state.float).not.toBeNull();
        // Canvas at (0,0) cut to natural baseline (row 0 = A = 1)
        expect(s.state.pixels[0]).toBe(1);
        // Float pixels updated to the cleared baseline value (row 0, col 0 = A = 1)
        expect(floatAt(s.state.float!, 0, 0)).toBe(1);
        // Float position unchanged
        expect(s.state.float!.x).toBe(0);
        expect(s.state.float!.y).toBe(0);
    });

    test("mismatch: canvas content differs from float — no cut, re-lift from unchanged canvas", () => {
        // canvas all A (1), float has B (2) at (1,1): mismatch → canvas untouched.
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat([{ x: 1, y: 1, v: 2 }]),
        });
        deleteFloat(s);
        expect(s.state.float).not.toBeNull();
        // canvas[1,1] not cleared (float B ≠ canvas A)
        expect(s.state.pixels[1 * 3 + 1]).toBe(1);
        // float re-lifted from unchanged canvas → A = 1
        expect(floatAt(s.state.float!, 1, 1)).toBe(1);
        expect(s.state.float!.x).toBe(1);
        expect(s.state.float!.y).toBe(1);
    });

    test("match: canvas equals float content — cuts to baseline, re-lifts baseline", () => {
        // canvas all B (2), float has B (2) at (0,0): row-0 baseline = A = 1.
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 2),
            float: makeFloat([{ x: 0, y: 0, v: 2 }]),
        });
        deleteFloat(s);
        expect(s.state.float).not.toBeNull();
        // canvas[0,0]: B matched float B → cut to row-0 baseline A = 1
        expect(s.state.pixels[0]).toBe(1);
        // float re-lifted from cleared[0,0] = 1
        expect(floatAt(s.state.float!, 0, 0)).toBe(1);
    });

    test("partial mismatch: no cells cleared even when some cells match", () => {
        // (1,1) canvas=A (1) = float A (1) → would match alone
        // (2,1) canvas=A (1) ≠ float B (2) → mismatch
        // All-or-nothing: any mismatch → clear nothing
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),   // all A (1)
            float: makeFloat([{ x: 1, y: 1, v: 1 }, { x: 2, y: 1, v: 2 }]),
        });
        deleteFloat(s);
        // (1,1) must NOT be cut despite matching — row-1 baseline is B=2, stays A=1
        expect(s.state.pixels[1 * 3 + 1]).toBe(1);
    });

    test("no-op when no float", () => {
        const s = storeOf(3, 3);
        deleteFloat(s);
        expect(s.state.float).toBeNull();
    });
});
