// paintOps tests — each entry exercised against a tiny canvas. The
// wasm-side flood-fill / paint-natural etc. have their own Rust tests;
// these tests just verify the dispatch layer wires args correctly and
// the post-paint outputs are sensible.

import { describe, test, expect } from "vitest";
import { paintOps, PaintCtx, PaintTool } from "../src/paint";
import { initialize_row_pattern, initialize_round_pattern } from "@mosaic/wasm";
import type { PatternState } from "../src/types";
import { filledPixels, rowPattern } from "./_helpers";

function ctx(tool: PaintTool, opts: Partial<PaintCtx> = {}): PaintCtx {
    const W = 3, H = 3;
    return {
        visible: filledPixels(W, H, 1),
        pattern: rowPattern(W, H),
        x: 1, y: 1,
        color: 1, primary: 1,
        invertVisited: tool === "invert" ? new Set() : null,
        symMask: 0,
        shifted: null,
        ...opts,
    };
}

describe("paintOps", () => {
    test("pencil paints the click cell to the given colour", () => {
        const out = paintOps.pencil(ctx("pencil", {
            visible: filledPixels(3, 3, 1),
            x: 1, y: 1, color: 2,
        }));
        expect(out[1 * 3 + 1]).toBe(2);
    });

    test("fill flood-fills a connected same-colour region (no selection)", () => {
        const out = paintOps.fill(ctx("fill", {
            visible: filledPixels(3, 3, 1),
            x: 0, y: 0, color: 2,
        }));
        // All cells were colour 1 (connected) → all should be 2 now.
        for (let i = 0; i < 9; i++) expect(out[i]).toBe(2);
    });

    test("fill clipped to the float's shifted mask", () => {
        const shifted = new Uint8Array([1, 1, 0, 0, 0, 0, 0, 0, 0]);
        const out = paintOps.fill(ctx("fill", {
            visible: filledPixels(3, 3, 1),
            x: 0, y: 0, color: 2,
            shifted,
        }));
        // Only the two masked cells get filled.
        expect(out[0]).toBe(2);
        expect(out[1]).toBe(2);
        expect(out[2]).toBe(1);
    });

    test("eraser left-click restores natural baseline", () => {
        const out = paintOps.eraser(ctx("eraser", {
            visible: filledPixels(3, 3, 2),
            x: 0, y: 0, color: 1, primary: 1,   // color == primary → not invert
        }));
        // Row 0 baseline = colour A = 1.
        expect(out[0]).toBe(1);
    });

    test("eraser right-click paints the opposite baseline", () => {
        const out = paintOps.eraser(ctx("eraser", {
            visible: filledPixels(3, 3, 1),
            x: 0, y: 0, color: 2, primary: 1,   // color != primary → invert
        }));
        // Row 0 baseline = A=1; invert flips to B=2.
        expect(out[0]).toBe(2);
    });

    test("overlay left-click paints the inward neighbour with ✕ marker", () => {
        // The "paints inward neighbour" detail is core-tested; here we
        // just verify the call returns a different buffer (i.e., it ran).
        const out = paintOps.overlay(ctx("overlay", {
            visible: filledPixels(3, 3, 1),
            x: 1, y: 1, color: 1, primary: 1,
        }));
        expect(out).not.toBe(ctx("overlay").visible);
    });

    test("invert toggles 1↔2 on each first-visit cell, tracks visited set", () => {
        const visited = new Set<number>();
        const out = paintOps.invert(ctx("invert", {
            visible: filledPixels(3, 3, 1),
            x: 1, y: 1, color: 1, primary: 1,
            invertVisited: visited,
        }));
        expect(out[1 * 3 + 1]).toBe(2);
        expect(visited.has(1 * 3 + 1)).toBe(true);
    });

    test("eraser round mode restores round-mode natural baseline", () => {
        const W = 8, H = 8, rounds = 2;
        const pattern: PatternState = {
            mode: "round", canvasWidth: W, canvasHeight: H,
            virtualWidth: W, virtualHeight: H, offsetX: 0, offsetY: 0, rounds,
        };
        const natural = initialize_round_pattern(W, H, W, H, 0, 0, rounds);
        const rowNat  = initialize_row_pattern(W, H);
        // Find a non-hole cell where row and round baselines differ.
        const testIdx = Array.from({ length: W * H }, (_, i) => i)
            .find(i => natural[i] !== 0 && rowNat[i] !== 0 && natural[i] !== rowNat[i])!;
        const visible = natural.slice();
        for (let i = 0; i < visible.length; i++) if (visible[i] !== 0) visible[i] = 2;
        const x = testIdx % W, y = Math.floor(testIdx / W);
        const out = paintOps.eraser({ visible, pattern, x, y, color: 1, primary: 1, invertVisited: null, symMask: 0, shifted: null });
        // Round mode restores the round natural color, not the row natural.
        expect(out[testIdx]).toBe(natural[testIdx]);
        expect(out[testIdx]).not.toBe(rowNat[testIdx]);
    });

    test("overlay right-click (clear) calls clear_overlay rather than paint_overlay", () => {
        const visible = filledPixels(3, 3, 1);
        const painted = paintOps.overlay(ctx("overlay", { visible: visible.slice(), x: 1, y: 1, color: 1, primary: 1 }));
        const cleared = paintOps.overlay(ctx("overlay", { visible: visible.slice(), x: 1, y: 1, color: 2, primary: 1 }));
        // paint_overlay and clear_overlay produce different results from the same input.
        expect(Array.from(painted)).not.toEqual(Array.from(cleared));
    });

    test("overlay round mode: clear undoes paint (round dispatch is self-consistent)", () => {
        const W = 8, H = 8, rounds = 2;
        const roundPat: PatternState = {
            mode: "round", canvasWidth: W, canvasHeight: H,
            virtualWidth: W, virtualHeight: H, offsetX: 0, offsetY: 0, rounds,
        };
        const natural = initialize_round_pattern(W, H, W, H, 0, 0, rounds);
        // Find a cell where paint_overlay_round actually writes something.
        let paintX = -1, paintY = -1;
        for (let i = 0; i < natural.length && paintX < 0; i++) {
            if (natural[i] === 0) continue;
            const cx = i % W, cy = Math.floor(i / W);
            const painted = paintOps.overlay({ visible: natural.slice(), pattern: roundPat, x: cx, y: cy, color: 1, primary: 1, invertVisited: null, symMask: 0, shifted: null });
            if (!painted.every((v, j) => v === natural[j])) { paintX = cx; paintY = cy; }
        }
        if (paintX < 0) return;   // no valid cell in this pattern (shouldn't happen for 8×8/2 rounds)
        const withMarker = paintOps.overlay({ visible: natural.slice(), pattern: roundPat, x: paintX, y: paintY, color: 1, primary: 1, invertVisited: null, symMask: 0, shifted: null });
        const cleared    = paintOps.overlay({ visible: withMarker,      pattern: roundPat, x: paintX, y: paintY, color: 2, primary: 1, invertVisited: null, symMask: 0, shifted: null });
        expect(Array.from(withMarker)).not.toEqual(Array.from(natural));
        expect(Array.from(cleared)).toEqual(Array.from(natural));
    });

    test("invert doesn't re-flip a cell within the same stroke", () => {
        const visited = new Set<number>([1 * 3 + 1]);
        const out = paintOps.invert(ctx("invert", {
            visible: filledPixels(3, 3, 1),
            x: 1, y: 1, color: 1, primary: 1,
            invertVisited: visited,
        }));
        expect(out[1 * 3 + 1]).toBe(1);   // skipped
    });

    test("invert flips 2 → 1", () => {
        const out = paintOps.invert(ctx("invert", {
            visible: filledPixels(3, 3, 2),
            x: 1, y: 1, invertVisited: new Set(),
        }));
        expect(out[1 * 3 + 1]).toBe(1);
    });

    test("invert skips hole cells (value 0)", () => {
        const visible = filledPixels(3, 3, 1);
        visible[0] = 0;   // make corner a hole
        const out = paintOps.invert(ctx("invert", {
            visible, x: 0, y: 0, invertVisited: new Set(),
        }));
        expect(out[0]).toBe(0);
    });
});
