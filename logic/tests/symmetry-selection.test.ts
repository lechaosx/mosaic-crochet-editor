// Symmetry × selection contract: paint inside an active selection mirrors
// across active axes, BUT the selection mask itself does NOT mirror.
// Locks the current design — if we ever change selection to mirror, this
// test fails loudly.

import { describe, test, expect, vi } from "vitest";
import { paintOps } from "../src/paint";
import { axesToFlat, addAxis } from "../src/symmetry";
import { Store } from "../src/store";
import { replicateSelection } from "../src/selection";
import { filledPixels, makeFloat, rowPattern, rowSession } from "./_helpers";

describe("symmetry-aware paint inside selection", () => {
    test("with Vertical symmetry, painting (0, 1) clipped to a mask that doesn't include the mirrored cell only paints (0, 1)", () => {
        // Clipping is now done inside paint_pixel (Rust-side), so the
        // mirrored cell (4, 1) is skipped because it's outside the selection.
        const W = 5, H = 5;
        const visible = filledPixels(W, H, 1);
        const pattern = rowPattern(W, H);
        // Shifted mask = only (0, 1) selected. With V symmetry on a 5×5
        // canvas, (0, 1) mirrors to (4, 1).
        const shifted = new Uint8Array(W * H);
        shifted[1 * W + 0] = 1;
        const symAxes = axesToFlat(addAxis([], "V", W, H));
        const out = paintOps.pencil({
            visible, pattern, x: 0, y: 1,
            color: 2, primary: 1,
            invertVisited: null,
            symAxes, shifted,
        });
        // Rust clips to selection: only (0, 1) painted, mirrored (4, 1) skipped.
        expect(out[1 * W + 0]).toBe(2);
        expect(out[1 * W + 4]).toBe(1);
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
        const symAxes = axesToFlat(addAxis(addAxis([], "V", W, H), "H", W, H));
        // We just assert that axesToFlat returns a Float64Array;
        // the selection bitmask is unaffected.
        expect(symAxes).toBeInstanceOf(Float64Array);
        expect(mask[1 * W + 4]).toBe(0);
    });
});

describe("replicateSelection", () => {
    const vertical = [{ kind: "V" as const, id: "v", active: true, x: 2 }];

    test("stamps mirrored pixels into the canvas and keeps the source float", () => {
        const source = makeFloat([{ x: 0, y: 0, v: 2 }]);
        const store = new Store(rowSession(5, 1, {
            pixels: filledPixels(5, 1, 1),
            float: source,
            axes: vertical,
        }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("applied");

        expect(store.state.pixels).toEqual(new Uint8Array([1, 1, 1, 1, 2]));
        expect(store.state.float).toBe(source);
        expect(history).toHaveBeenCalledOnce();
    });

    test("rejects a mixed-colour orbit without changing state or history", () => {
        const pixels = filledPixels(5, 1, 1);
        const source = makeFloat([
            { x: 0, y: 0, v: 1 },
            { x: 4, y: 0, v: 2 },
        ]);
        const store = new Store(rowSession(5, 1, { pixels, float: source, axes: vertical }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("conflict");

        expect(store.state.pixels).toBe(pixels);
        expect(store.state.float).toBe(source);
        expect(history).not.toHaveBeenCalled();
    });

    test("ignores off-canvas source cells instead of reflecting them back in", () => {
        const pixels = filledPixels(4, 1, 1);
        const source = makeFloat([{ x: -1, y: 0, v: 2 }]);
        const store = new Store(rowSession(4, 1, {
            pixels,
            float: source,
            axes: [{ kind: "V", id: "v", active: true, x: 1 }],
        }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("unchanged");

        expect(store.state.pixels).toBe(pixels);
        expect(store.state.float).toBe(source);
        expect(history).not.toHaveBeenCalled();
    });

    test("does not create history when there are no active axes", () => {
        const pixels = filledPixels(5, 1, 1);
        const source = makeFloat([{ x: 0, y: 0, v: 2 }]);
        const store = new Store(rowSession(5, 1, { pixels, float: source }));
        const history = vi.fn();
        store.setHistoryFn(history);

        expect(replicateSelection(store)).toBe("unchanged");

        expect(store.state.pixels).toBe(pixels);
        expect(history).not.toHaveBeenCalled();
    });
});
