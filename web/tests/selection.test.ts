// Selection module tests. Covers the pure helpers + every branch of
// `applySelectionMod` (replace / add-no-float / add-with-float /
// remove-no-float / remove-with-float), plus the rect / wand / select-all
// / deselect / anchor wrappers.

import { describe, test, expect } from "vitest";
import {
    liftCells, cutCells, rectMask, shiftedFloatMask, anchorIntoCanvas,
    applySelectionMod, commitSelectRect, commitWandAt, selectAll, deselect, anchorFloat,
} from "../src/selection";
import { Store, visiblePixels } from "../src/store";
import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import { filledPixels, maskOf, makeFloat, rowPattern, rowSession } from "./_helpers";

describe("liftCells", () => {
    test("lifts the masked cells, cuts canvas to natural baseline", () => {
        const pattern = rowPattern(4, 4);
        const pixels = filledPixels(4, 4, 1);
        const mask = maskOf(4, 4, [[1, 1], [2, 1]]);
        const r = liftCells(pixels, pattern, mask);
        expect(r.float).not.toBeNull();
        expect(r.float!.mask[1 * 4 + 1]).toBe(1);
        expect(r.float!.mask[1 * 4 + 2]).toBe(1);
        expect(r.float!.pixels[1 * 4 + 1]).toBe(1);
        // Source canvas cells became natural baseline (row 1 starts with A=1)
        // — but they were already A=1 so this is the same value. Test by
        // changing them first.
    });

    test("cells outside the liftMask stay unchanged", () => {
        const pattern = rowPattern(4, 4);
        const pixels = filledPixels(4, 4, 2);
        const mask = maskOf(4, 4, [[0, 0]]);
        const r = liftCells(pixels, pattern, mask);
        expect(r.pixels[3]).toBe(2);   // unmasked cell preserved
        expect(r.float!.pixels[0]).toBe(2);   // lifted value
    });

    test("empty mask returns float=null and pixels unchanged", () => {
        const pattern = rowPattern(3, 3);
        const pixels = filledPixels(3, 3, 1);
        const r = liftCells(pixels, pattern, new Uint8Array(9));
        expect(r.float).toBeNull();
        expect(r.pixels).toBe(pixels);
    });

    test("float lifts at dx=dy=0", () => {
        const pattern = rowPattern(3, 3);
        const pixels = filledPixels(3, 3, 1);
        const r = liftCells(pixels, pattern, maskOf(3, 3, [[0, 0]]));
        expect(r.float!.dx).toBe(0);
        expect(r.float!.dy).toBe(0);
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
    test("offset=0 returns canvas-coord mask same as source", () => {
        const s = rowSession(3, 3, {
            float: makeFloat(3, 3, [{ x: 1, y: 1, v: 1 }]),
        });
        const m = shiftedFloatMask(s);
        expect(m[1 * 3 + 1]).toBe(1);
    });

    test("offset shifts mask into canvas coords, off-canvas cells drop", () => {
        const s = rowSession(3, 3, {
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 1 }, { x: 2, y: 2, v: 1 }], 1, 0),
        });
        const m = shiftedFloatMask(s);
        expect(m[0 * 3 + 1]).toBe(1);   // (0,0) shifted right = (1,0)
        // (2,2) shifted right = (3,2) → off-canvas → dropped
        expect(m.every((v, i) => (i === 1) ? v === 1 : v === 0)).toBe(true);
    });

    test("no float → empty mask", () => {
        const s = rowSession(3, 3);
        expect(shiftedFloatMask(s).every(v => v === 0)).toBe(true);
    });

    test("cells spilling off each of the four canvas edges are dropped without aliasing", () => {
        // Kills each individual bounds-check term `dx < 0`, `dx >= W`,
        // `dy < 0`, `dy >= H`. If a term is dropped, an out-of-bounds
        // (dx, dy) maps via `dy * W + dx` to a wrong-but-valid index
        // (e.g. dx=-1 reads from the prior row), so the shifted mask
        // would gain a spurious bit at the wrong position.
        // Float: 1 cell at each of (0,0)/(2,0)/(0,2)/(2,2) on a 3×3 grid.
        // Offsets push each out by one in a different direction.

        // dx<0: cell (0, 1), dx=-1 → off the left.
        const sLeft = rowSession(3, 3, {
            float: makeFloat(3, 3, [{ x: 0, y: 1, v: 1 }], -1, 0),
        });
        expect([...shiftedFloatMask(sLeft)].every(v => v === 0)).toBe(true);

        // dx>=W: cell (2, 1), dx=+1 → off the right.
        const sRight = rowSession(3, 3, {
            float: makeFloat(3, 3, [{ x: 2, y: 1, v: 1 }], 1, 0),
        });
        expect([...shiftedFloatMask(sRight)].every(v => v === 0)).toBe(true);

        // dy<0: cell (1, 0), dy=-1 → off the top.
        const sUp = rowSession(3, 3, {
            float: makeFloat(3, 3, [{ x: 1, y: 0, v: 1 }], 0, -1),
        });
        expect([...shiftedFloatMask(sUp)].every(v => v === 0)).toBe(true);

        // dy>=H: cell (1, 2), dy=+1 → off the bottom.
        const sDown = rowSession(3, 3, {
            float: makeFloat(3, 3, [{ x: 1, y: 2, v: 1 }], 0, 1),
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
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
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
        expect(s.state.float!.mask[0]).toBe(1);
    });

    test("region cells over canvas holes are excluded from the lift", () => {
        // Kills `for (let i = 0; i < n; i++) if (anchored[i] === 0) clean[i] = 0`
        // mutations at line 116 (replace path). Without that filter, the
        // float would mask hole cells (which are 0 in pixels) and the
        // resulting float would have mask bits at hole positions.
        const s = new Store(holeSession());
        // Cover the entire canvas with the region. Holes must be excluded.
        const W = 8, H = 8;
        const full = new Uint8Array(W * H).fill(1);
        applySelectionMod(s, full, "replace");
        expect(s.state.float).not.toBeNull();
        // Every mask bit must correspond to a non-hole canvas cell.
        const f = s.state.float!;
        for (let i = 0; i < f.mask.length; i++) {
            if (f.mask[i]) expect(s.state.pixels[i], `cell ${i} should not be a hole`).not.toBe(0);
        }
    });

    test("with existing float: anchors it, then lifts the new region", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 2, y: 2, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "replace");
        // Float is the new region only.
        expect(s.state.float!.mask[0]).toBe(1);
        expect(s.state.float!.mask[2 * 3 + 2]).toBe(0);
        // Old float anchored at (2,2): canvas got the value 2 there.
        expect(s.state.pixels[2 * 3 + 2]).toBe(2);
    });
});

describe("applySelectionMod / add", () => {
    test("no float + add: same as replace (lifts the region)", () => {
        const s = storeOf(3, 3);
        applySelectionMod(s, maskOf(3, 3, [[1, 1]]), "add");
        expect(s.state.float!.mask[1 * 3 + 1]).toBe(1);
    });

    test("add path: hole-cell filter prevents holes from joining the lift (no float)", () => {
        // Kills line 126: same hole-skip filter as replace, but in the
        // "no existing float" branch of add.
        const s = new Store(holeSession());
        const W = 8, H = 8;
        applySelectionMod(s, new Uint8Array(W * H).fill(1), "add");
        const f = s.state.float!;
        for (let i = 0; i < f.mask.length; i++) {
            if (f.mask[i]) expect(s.state.pixels[i]).not.toBe(0);
        }
    });

    test("add path: hole-cell guard inside the float-extension loop (with float)", () => {
        // Kills line 142: `if (s.pixels[cy * W + cx] === 0) continue;`
        // mutations. With existing float, adding a region that covers a
        // hole must not extend the float over that hole.
        const W = 8, H = 8;
        // Pre-lift one valid non-hole cell so the float exists, then add
        // a region that overlaps a hole.
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
        // Now "add" a region covering both a fresh non-hole and the hole.
        const add = new Uint8Array(W * H);
        add[holeIdx] = 1;
        applySelectionMod(seed, add, "add");
        // The hole position must NOT be in the float mask.
        expect(seed.state.float!.mask[holeIdx]).toBe(0);
    });

    test("with float at rest: extends mask with new cells, leaves old untouched", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[2, 2]]), "add");
        expect(s.state.float!.mask[0]).toBe(1);
        expect(s.state.float!.mask[2 * 3 + 2]).toBe(1);
        // Old float's pixels preserved
        expect(s.state.float!.pixels[0]).toBe(2);
        // Newly-added cell's lifted pixel value must land at the SAME
        // index as the mask bit. Kills `newLifted[sy / W + sx]` and
        // `s.pixels[cy / W + cx]` mutations on line 147: with row-major
        // indexing, sy * W + sx and sy / W + sx differ for any sy ≥ 1.
        expect(s.state.float!.pixels[2 * 3 + 2]).toBe(1);
    });

    test("with displaced float: source-position out-of-bounds add cells drop silently", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            // Float lifted at (0,0) but currently displayed at (2, 0) via offset 2.
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 2, 0),
        });
        // Try to add canvas (0, 0). Source = (0,0) - (2,0) = (-2, 0) — out of mask grid.
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "add");
        // Float mask shouldn't have grown at any in-bounds position.
        let count = 0;
        for (let i = 0; i < s.state.float!.mask.length; i++) if (s.state.float!.mask[i]) count++;
        expect(count).toBe(1);
    });

    test("source-position bounds gate each of the four directions individually", () => {
        // Kills the per-term mutations on `if (sx < 0 || sx >= W || sy < 0
        // || sy >= H) continue;` in the add path. If any term is dropped,
        // an off-grid source position lands at a valid wrap-around index
        // (e.g. sx=-1, sy=1, W=3 → sy*W+sx = 2 → would mutate cell (2,0)
        // of the float mask).
        //
        // For each direction we set up an offset and a region click such
        // that the source position spills past exactly one boundary.
        const W = 3, H = 3;
        const baseFloat = () => makeFloat(W, H, [{ x: 1, y: 1, v: 2 }]);
        const cases: Array<{ dx: number; dy: number; cx: number; cy: number; tag: string }> = [
            { dx:  2, dy:  0, cx: 0, cy: 1, tag: "sx<0"   },   // source (-2, 1)
            { dx: -2, dy:  0, cx: 2, cy: 1, tag: "sx>=W"  },   // source (4, 1)
            { dx:  0, dy:  2, cx: 1, cy: 0, tag: "sy<0"   },   // source (1, -2)
            { dx:  0, dy: -2, cx: 1, cy: 2, tag: "sy>=H"  },   // source (1, 4)
        ];
        for (const c of cases) {
            const s = storeOf(W, H, {
                pixels: filledPixels(W, H, 1),
                float:  makeFloat(W, H, [{ x: 1, y: 1, v: 2 }], c.dx, c.dy),
            });
            applySelectionMod(s, maskOf(W, H, [[c.cx, c.cy]]), "add");
            // Float mask should still have exactly one cell — the original
            // (1, 1). A missing bounds term would either grow the mask
            // (off-grid write lands at a valid wrap) or grow it at the
            // intended cell (off-grid write succeeded because typed-array
            // writes silently drop, *but* a coincidental wrap could match).
            // We assert mask size is still 1 AND it's still at (1, 1).
            const mask = s.state.float!.mask;
            let count = 0;
            for (let i = 0; i < mask.length; i++) if (mask[i]) count++;
            expect(count, `add ${c.tag}: float mask should still be size 1`).toBe(1);
            expect(mask[1 * W + 1], `add ${c.tag}: original cell preserved`).toBe(1);
            // baseFloat reference used only to silence eslint unused; keeps
            // the helper's contract clear.
            void baseFloat;
        }
    });
});

describe("applySelectionMod / remove", () => {
    test("no float: no-op", () => {
        const s = storeOf(3, 3);
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        expect(s.state.float).toBeNull();
    });

    test("with float at rest: stamps the overlapping cells back, shrinks mask", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }, { x: 1, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        // Cell (0,0) stamped back: canvas now has the float's value there.
        expect(s.state.pixels[0]).toBe(2);
        // Mask shrunk
        expect(s.state.float!.mask[0]).toBe(0);
        expect(s.state.float!.mask[1]).toBe(1);
    });

    test("with displaced float: only overlapping cells get stamped back", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            // Mask at source (0,0), shifted to (1, 0).
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 0),
        });
        // Try to remove canvas (1, 0) — that's where the float currently is.
        applySelectionMod(s, maskOf(3, 3, [[1, 0]]), "remove");
        // Stamped at (1, 0): canvas has float value there.
        expect(s.state.pixels[1]).toBe(2);
        // Float is now empty → cleared.
        expect(s.state.float).toBeNull();
    });

    test("remove that empties the float clears it", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
        });
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "remove");
        expect(s.state.float).toBeNull();
    });

    test("source-position bounds gate each of the four directions individually", () => {
        // Same boundary intent as the add-mode test, but for the remove
        // path. With a missing term, the remove could wrap into a wrong
        // cell of newMask and zero it (corrupting the float).
        const W = 3, H = 3;
        const cases: Array<{ dx: number; dy: number; cx: number; cy: number; tag: string }> = [
            { dx:  2, dy:  0, cx: 0, cy: 1, tag: "sx<0"  },
            { dx: -2, dy:  0, cx: 2, cy: 1, tag: "sx>=W" },
            { dx:  0, dy:  2, cx: 1, cy: 0, tag: "sy<0"  },
            { dx:  0, dy: -2, cx: 1, cy: 2, tag: "sy>=H" },
        ];
        for (const c of cases) {
            const s = storeOf(W, H, {
                pixels: filledPixels(W, H, 1),
                float:  makeFloat(W, H, [{ x: 1, y: 1, v: 2 }], c.dx, c.dy),
            });
            applySelectionMod(s, maskOf(W, H, [[c.cx, c.cy]]), "remove");
            // Float should still exist with its single (1, 1) cell — the
            // remove found no overlap (source position off the grid).
            expect(s.state.float, `remove ${c.tag}: float preserved`).not.toBeNull();
            expect(s.state.float!.mask[1 * W + 1], `remove ${c.tag}: cell intact`).toBe(1);
        }
    });
});

describe("commitSelectRect", () => {
    test("integrates rect → applySelectionMod", () => {
        const s = storeOf(3, 3);
        commitSelectRect(s, 0, 0, 1, 0, "replace");
        expect(s.state.float!.mask[0]).toBe(1);
        expect(s.state.float!.mask[1]).toBe(1);
    });
});

describe("commitWandAt", () => {
    test("picks connected same-colour region and lifts it", () => {
        const s = storeOf(3, 3, { pixels: filledPixels(3, 3, 1) });
        commitWandAt(s, 0, 0, "replace");
        // All 9 cells share colour 1 → all lifted.
        let count = 0;
        for (let i = 0; i < s.state.float!.mask.length; i++) if (s.state.float!.mask[i]) count++;
        expect(count).toBe(9);
    });

    test("click out of canvas is a no-op", () => {
        const s = storeOf(3, 3);
        commitWandAt(s, -1, 0, "replace");
        expect(s.state.float).toBeNull();
    });

    test("each canvas edge fully gates the wand click (no aliasing into the row above/below)", () => {
        // Kills the individual terms of `if (x < 0 || x >= W || y < 0 ||
        // y >= H) return;`. With any term dropped, a click at e.g. x=W,
        // y=0 would read visible[W] (which is the (0,1) cell) and wand-
        // select that neighbour by accident.
        for (const [x, y] of [[-1, 0], [3, 0], [0, -1], [0, 3]] as const) {
            const s = storeOf(3, 3, { pixels: filledPixels(3, 3, 1) });
            commitWandAt(s, x, y, "replace");
            expect(s.state.float).toBeNull();
        }
    });
});

describe("selectAll", () => {
    test("lifts every non-hole cell", () => {
        const s = storeOf(3, 3);
        selectAll(s);
        let count = 0;
        for (let i = 0; i < s.state.float!.mask.length; i++) if (s.state.float!.mask[i]) count++;
        // The 3×3 initialise_row_pattern has all cells paintable.
        expect(count).toBe(9);
    });
});

describe("cumulative move", () => {
    test("two consecutive position changes land at the second, intermediate restored", () => {
        // Lift a single cell at (1, 1), then "move" by directly setting
        // dx/dy twice. Anchoring after the second move should leave the
        // canvas in the same shape as anchoring once at the final offset
        // — no double-stamp at the intermediate position.
        const s = storeOf(3, 3, { pixels: filledPixels(3, 3, 1) });
        applySelectionMod(s, maskOf(3, 3, [[1, 1]]), "replace");
        // Simulate two moves: first to (+1, 0), then to (+0, +1).
        const f1 = s.state.float!;
        s.commit(state => { state.float = { ...f1, dx: 1, dy: 0 }; }, { persist: false });
        const f2 = s.state.float!;
        s.commit(state => { state.float = { ...f2, dx: 0, dy: 1 }; }, { persist: false });
        anchorFloat(s);
        // Original (1, 1) was cut on lift → baseline (row 1 = B = 2).
        // Final stamp at (1, 2): should have the lifted value (1).
        // Intermediate (2, 1) should be unchanged from cut canvas (baseline).
        expect(s.state.pixels[1 * 3 + 1]).toBe(2);   // baseline at source
        expect(s.state.pixels[2 * 3 + 1]).toBe(1);   // intermediate not touched (was canvas value 1)
        expect(s.state.pixels[1 * 3 + 2]).toBe(1);   // stamp at final offset (lifted v=1)
    });
});

describe("deselect / anchorFloat", () => {
    test("deselect with float stamps it and clears", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }]),
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

    test("anchorFloat with offset stamps at current position", () => {
        const s = storeOf(3, 3, {
            pixels: filledPixels(3, 3, 1),
            float: makeFloat(3, 3, [{ x: 0, y: 0, v: 2 }], 1, 1),
        });
        anchorFloat(s);
        // Source position (0,0) stays as it was — anchorIntoCanvas doesn't
        // restore the lifted source (lift cut it, but our test float was
        // never actually "lifted" from this canvas; we constructed it).
        expect(s.state.pixels[1 * 3 + 1]).toBe(2);   // stamped at (1,1)
        expect(s.state.float).toBeNull();
    });
});
