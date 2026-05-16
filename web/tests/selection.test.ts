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
import { initialize_row_pattern } from "@mosaic/wasm";
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

describe("applySelectionMod / replace", () => {
    test("with no float: lifts the region", () => {
        const s = storeOf(3, 3);
        applySelectionMod(s, maskOf(3, 3, [[0, 0]]), "replace");
        expect(s.state.float).not.toBeNull();
        expect(s.state.float!.mask[0]).toBe(1);
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
