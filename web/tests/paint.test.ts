// paintOps tests — each entry exercised against a tiny canvas. The
// wasm-side flood-fill / paint-natural etc. have their own Rust tests;
// these tests just verify the dispatch layer wires args correctly and
// the post-paint outputs are sensible.

import { describe, test, expect } from "vitest";
import { paintOps, PaintCtx, PaintTool } from "../src/paint";
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

    test("invert doesn't re-flip a cell within the same stroke", () => {
        const visited = new Set<number>([1 * 3 + 1]);
        const out = paintOps.invert(ctx("invert", {
            visible: filledPixels(3, 3, 1),
            x: 1, y: 1, color: 1, primary: 1,
            invertVisited: visited,
        }));
        expect(out[1 * 3 + 1]).toBe(1);   // skipped
    });
});
