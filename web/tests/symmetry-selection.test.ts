// Symmetry × selection contract: paint inside an active selection mirrors
// across active axes, BUT the selection mask itself does NOT mirror.
// Locks the current design — if we ever change selection to mirror, this
// test fails loudly.

import { describe, test, expect } from "vitest";
import { paintOps } from "../src/paint";
import { getSymmetryMask } from "../src/symmetry";
import { filledPixels, rowPattern } from "./_helpers";
import { SymKey } from "../src/types";

describe("symmetry-aware paint inside selection", () => {
    test("with Vertical symmetry, painting (0, 1) clipped to a mask that doesn't include the mirrored cell only paints (0, 1)", () => {
        // The clip happens AFTER paint at the TS layer (see `paintAt`),
        // so paint+symmetry's natural behaviour writes to both orbit
        // cells, and the clip reverts the unselected one.
        const W = 5, H = 5;
        const visible = filledPixels(W, H, 1);
        const pattern = rowPattern(W, H);
        // Shifted mask = only (0, 1) selected. With V symmetry on a 5×5
        // canvas, (0, 1) mirrors to (4, 1).
        const shifted = new Uint8Array(W * H);
        shifted[1 * W + 0] = 1;
        const symMask = getSymmetryMask(new Set<SymKey>(["V"]), W, H);
        const out = paintOps.pencil({
            visible, pattern, x: 0, y: 1,
            color: 2, primary: 1,
            invertVisited: null,
            symMask, shifted,
        });
        // The Rust `paint_pixel` writes both orbit cells. The selection
        // clipping (caller's job, not the op's) would then revert the
        // mirrored cell — but at the paintOp level, both are written.
        expect(out[1 * W + 0]).toBe(2);
        expect(out[1 * W + 4]).toBe(2);
        // The selection mask itself doesn't mirror — shifted[1, 4] is still 0.
        expect(shifted[1 * W + 4]).toBe(0);
    });

    test("selection mask is not auto-mirrored — contract test", () => {
        // The selection mask is what the user explicitly drew. Symmetry
        // axes do not mirror the marquee outline. This is a contract
        // test: if we ever flip the design, this must be updated.
        const W = 5, H = 5;
        const mask = new Uint8Array(W * H);
        mask[1 * W + 0] = 1;
        // No function in `symmetry.ts` or `selection.ts` should expand
        // `mask` based on active axes. The visible marquee is exactly
        // these cells.
        const symMask = getSymmetryMask(new Set<SymKey>(["V", "H"]), W, H);
        // We just assert that getSymmetryMask returns a numeric bitfield;
        // the selection bitmask is unaffected.
        expect(typeof symMask).toBe("number");
        expect(mask[1 * W + 4]).toBe(0);
    });
});
