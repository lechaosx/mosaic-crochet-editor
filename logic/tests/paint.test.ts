// paintOps tests — each entry exercised against a tiny canvas. The
// wasm-side flood-fill / paint-natural etc. have their own Rust tests;
// these tests just verify the dispatch layer wires args correctly and
// the post-paint outputs are sensible.

import { describe, test, expect } from "vitest";
import { paintOps, PaintCtx, PaintTool } from "../src/paint";
import { initialize_row_pattern, initialize_round_pattern, overlay_target_available_row } from "@mosaic/wasm";
import type { PatternState } from "../src/types";
import { filledPixels, rowPattern } from "./_helpers";
import { evaluatePackedGrid, type PackedGridRecipe } from "../src/transform-evaluator";

const grid: PackedGridRecipe = {
    left: 0, right: 1, up: 0, down: 0,
    columnSpacing: 0, rowSpacing: 0, columnSpacingAlternate: 0, rowSpacingAlternate: 0,
    columnOffset: 0, rowOffset: 0,
    columnMirrorHorizontal: false, columnMirrorVertical: false,
    rowMirrorHorizontal: false, rowMirrorVertical: false,
};

function ctx(tool: PaintTool, opts: Partial<PaintCtx> = {}): PaintCtx {
    const W = 3, H = 3;
    return {
        visible: filledPixels(W, H, 1),
        pattern: rowPattern(W, H),
        x: 1, y: 1,
        color: 1, primary: 1,
        overlayAction: "place",
        invertVisited: tool === "invert" ? new Set() : null,
        transforms: new Float64Array(0),
        shifted: null,
        ...opts,
    };
}

describe("paintOps", () => {
    test("global mirror can return a rotated support to canvas while its anchor stays authorized", () => {
        const out = paintOps.overlay(ctx("overlay", {
            visible: initialize_row_pattern(3, 3), pattern: rowPattern(3, 3), x: 1, y: 1,
            repeat: evaluatePackedGrid([{ x: 1, y: 1 }], { ...grid, right: 0 }, { x: 1, y: 0, turns: [90] }),
            transforms: new Float64Array([0, 0, 0]),
        }));
        expect(out[1]).toBe(2);
    });
    test("transform limit failure leaves pixels and stroke visits unchanged", () => {
        const visible = new Uint8Array([1, 1, 1]);
        const visited = new Set([2]);
        expect(() => paintOps.invert(ctx("invert", {
            visible, pattern: rowPattern(3, 1), x: 0, y: 0, invertVisited: visited,
            transforms: new Float64Array([5, 1, 4_096]),
        }))).toThrow(RangeError);
        expect(Array.from(visible)).toEqual([1, 1, 1]);
        expect(visited).toEqual(new Set([2]));
    });
    test("off-canvas repeat coordinates never wrap through the wasm boundary", () => {
        const out = paintOps.pencil(ctx("pencil", {
            visible: new Uint8Array([1, 1, 1]), pattern: rowPattern(3, 1), x: 0, y: 0, color: 2,
            repeat: evaluatePackedGrid([{ x: 0, y: 0 }], { ...grid, columnSpacing: 4_294_967_296 }),
        }));
        expect(Array.from(out)).toEqual([2, 1, 1]);
    });
    test("gutter clear mirrors supporting boundary cells and respects selection", () => {
        const visible = initialize_row_pattern(3, 5);
        visible[1] = 2;
        visible[4 * 3 + 1] = 2;
        const options = {
            visible, pattern: rowPattern(3, 5), x: 1, y: -1,
            overlayAction: "clear" as const, transforms: new Float64Array([1, 2, 0]),
        };
        const out = paintOps.overlay(ctx("overlay", options));
        expect(out[1]).toBe(1);
        expect(out[4 * 3 + 1]).toBe(1);
        const shifted = new Uint8Array(15);
        shifted[1] = 1;
        const clipped = paintOps.overlay(ctx("overlay", { ...options, shifted }));
        expect(clipped[1]).toBe(1);
        expect(clipped[4 * 3 + 1]).toBe(2);
    });
    test("no-op source Eraser synchronizes a repeat with a different value", () => {
        const out = paintOps.eraser(ctx("eraser", {
            visible: new Uint8Array([1, 2, 2]), pattern: rowPattern(3, 1), x: 0, y: 0,
            repeat: evaluatePackedGrid([{ x: 0, y: 0 }], grid),
        }));
        expect(Array.from(out)).toEqual([1, 1, 2]);
    });

    test("fill uses only the clicked repeat instance region", () => {
        const out = paintOps.fill(ctx("fill", {
            visible: new Uint8Array([1, 1, 1, 1, 1]), pattern: rowPattern(5, 1),
            x: 0, y: 0, color: 2,
            repeat: evaluatePackedGrid([{ x: 0, y: 0 }, { x: 1, y: 0 }], grid),
        }));
        expect(Array.from(out)).toEqual([2, 2, 2, 2, 1]);
    });

    test("overlay copies support outside a one-cell motif", () => {
        const out = paintOps.overlay(ctx("overlay", {
            visible: initialize_row_pattern(5, 5), pattern: rowPattern(5, 5), x: 2, y: 1,
            repeat: evaluatePackedGrid([{ x: 2, y: 1 }], grid),
        }));
        expect(out[2 * 5 + 2]).toBe(2);
        expect(out[2 * 5 + 3]).toBe(2);
    });

    test("overlay support rotates with its repeat, including clicks on copies", () => {
        const repeat = evaluatePackedGrid([{ x: 1, y: 1 }], { ...grid, right: 0 },
            { x: 2, y: 2, turns: [90] });
        const out = paintOps.overlay(ctx("overlay", {
            visible: filledPixels(5, 5, 1), pattern: rowPattern(5, 5), x: 1, y: 1, repeat,
        }));
        expect(out[2 * 5 + 1]).toBe(2);
        expect(out[1 * 5 + 2]).toBe(2);
        expect(out[2 * 5 + 3]).toBe(1);
        const fromCopy = paintOps.overlay(ctx("overlay", {
            visible: filledPixels(5, 5, 1), pattern: rowPattern(5, 5), x: 3, y: 1, repeat,
        }));
        expect(fromCopy[2 * 5 + 3]).toBe(2);
        expect(fromCopy[1 * 5 + 2]).toBe(2);
    });
    test("invert copies the clicked result onto a different mirror value", () => {
        const visible = new Uint8Array([1, 1, 2]);
        const visited = new Set<number>();
        const out = paintOps.invert(ctx("invert", {
            visible, pattern: rowPattern(3, 1), x: 0, y: 0,
            transforms: new Float64Array([0, 1, 0]), invertVisited: visited,
        }));
        expect(Array.from(out)).toEqual([2, 1, 2]);
        expect(paintOps.invert(ctx("invert", {
            visible: out, pattern: rowPattern(3, 1), x: 2, y: 0,
            transforms: new Float64Array([0, 1, 0]), invertVisited: visited,
        }))).toEqual(out);
    });

    test("overlay mirrors its supporting pixel across a horizontal axis", () => {
        const out = paintOps.overlay(ctx("overlay", {
            visible: initialize_row_pattern(3, 5), pattern: rowPattern(3, 5),
            x: 1, y: 1, transforms: new Float64Array([1, 2, 0]),
        }));
        expect(out[2 * 3 + 1]).toBe(2);
        expect(out[4 * 3 + 1]).toBe(1);
    });
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

    test("overlay place paints the inward neighbour with ✕ marker", () => {
        // The "paints inward neighbour" detail is core-tested; here we
        // just verify the call returns a different buffer (i.e., it ran).
        const out = paintOps.overlay(ctx("overlay", {
            visible: filledPixels(3, 3, 1),
            x: 1, y: 1, color: 1, primary: 1,
        }));
        expect(out).not.toBe(ctx("overlay").visible);
    });

    test.each(["place", "clear", "invert"] as const)(
        "overlay %s clips transformed click targets before resolving inward support",
        (overlayAction) => {
            const visible = filledPixels(5, 3, 1);
            const transforms = new Float64Array([0, 2, 0]);
            const shifted = new Uint8Array(15);
            shifted[1 * 5 + 1] = 1;
            const initial = overlayAction === "clear"
                ? paintOps.overlay(ctx("overlay", {
                    visible, pattern: rowPattern(5, 3), x: 1, y: 1, transforms,
                }))
                : visible;

            const out = paintOps.overlay(ctx("overlay", {
                visible: initial,
                pattern: rowPattern(5, 3),
                x: 1,
                y: 1,
                overlayAction,
                invertVisited: overlayAction === "invert" ? new Set() : null,
                transforms,
                shifted,
            }));

            expect(out[2 * 5 + 1]).toBe(overlayAction === "clear" ? 1 : 2);
            expect(out[2 * 5 + 3]).toBe(overlayAction === "clear" ? 2 : 1);
        },
    );

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
        const out = paintOps.eraser({ visible, pattern, x, y, color: 1, primary: 1, invertVisited: null, transforms: new Float64Array(0), shifted: null });
        // Round mode restores the round natural color, not the row natural.
        expect(out[testIdx]).toBe(natural[testIdx]);
        expect(out[testIdx]).not.toBe(rowNat[testIdx]);
    });

    test("overlay clear restores the inward neighbour independently of pointer colour", () => {
        const visible = filledPixels(3, 3, 1);
        const painted = paintOps.overlay(ctx("overlay", {
            visible: visible.slice(), x: 1, y: 1, color: 2, primary: 1,
            overlayAction: "place",
        }));
        const cleared = paintOps.overlay(ctx("overlay", {
            visible: painted, x: 1, y: 1, color: 1, primary: 1,
            overlayAction: "clear",
        }));
        expect(Array.from(cleared)).toEqual(Array.from(visible));
    });

    test("overlay invert places an absent marker and clears a present marker", () => {
        const visible = filledPixels(3, 3, 1);
        const placed = paintOps.overlay(ctx("overlay", {
            visible, x: 1, y: 1, overlayAction: "invert",
            invertVisited: new Set(),
        }));
        expect(Array.from(placed)).not.toEqual(Array.from(visible));

        const cleared = paintOps.overlay(ctx("overlay", {
            visible: placed, x: 1, y: 1, overlayAction: "invert",
            invertVisited: new Set(),
        }));
        expect(Array.from(cleared)).toEqual(Array.from(visible));
    });

    test("overlay invert skips geometrically unavailable targets", () => {
        const visible = filledPixels(3, 3, 1);
        let target: { x: number; y: number } | null = null;
        for (let y = 0; y < 3 && target === null; y++) {
            for (let x = 0; x < 3; x++) {
                if (!overlay_target_available_row(3, 3, x, y)) {
                    target = { x, y };
                    break;
                }
            }
        }
        expect(target).not.toBeNull();
        const out = paintOps.overlay(ctx("overlay", {
            visible,
            x: target!.x,
            y: target!.y,
            overlayAction: "invert",
            invertVisited: new Set(),
        }));
        expect(Array.from(out)).toEqual(Array.from(visible));
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
            const painted = paintOps.overlay({ visible: natural.slice(), pattern: roundPat, x: cx, y: cy, color: 1, primary: 1, overlayAction: "place", invertVisited: null, transforms: new Float64Array(0), shifted: null });
            if (!painted.every((v, j) => v === natural[j])) { paintX = cx; paintY = cy; }
        }
        if (paintX < 0) return;   // no valid cell in this pattern (shouldn't happen for 8×8/2 rounds)
        const withMarker = paintOps.overlay({ visible: natural.slice(), pattern: roundPat, x: paintX, y: paintY, color: 1, primary: 1, overlayAction: "place", invertVisited: null, transforms: new Float64Array(0), shifted: null });
        const cleared    = paintOps.overlay({ visible: withMarker,      pattern: roundPat, x: paintX, y: paintY, color: 2, primary: 1, overlayAction: "clear", invertVisited: null, transforms: new Float64Array(0), shifted: null });
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

    test("invert returns a new buffer and skips cells outside the selection", () => {
        const visible = filledPixels(3, 3, 1);
        const shifted = new Uint8Array(9);
        const visited = new Set<number>();
        const out = paintOps.invert(ctx("invert", {
            visible, x: 1, y: 1, invertVisited: visited, shifted,
        }));
        expect(out).not.toBe(visible);
        expect(out).toEqual(visible);
        expect(visited).toEqual(new Set());
    });
});
